import crypto from "node:crypto";
import { readDatabase, writeDatabase, readRepoJson, writeRepoJson } from "../_github.js";
import { verifyAdminToken } from "../_admin.js";
import { normalizeProduct, productStock, typeStock, safeUser } from "../_store.js";
import { sendEmail } from "../_gmail.js";

const PRODUCTS_PATH = "produk.json";

const FORM_FIELDS = {
  email: "Email",
  emailPassword: "Password Email",
  mlId: "ID ML",
  ffId: "ID FF",
  meterNumber: "Nomor meter",
  phone: "Nomor telepon",
  ewalletNumber: "Nomor e-wallet"
};

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function adminAuth(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyAdminToken(token);
}
function addSubscription(user, item, purchaseId) {
  user.subscriptions ||= [];
  const now = Date.now();
  const durationDays = item.durationDays == null ? null : Number(item.durationDays);
  const existing = user.subscriptions.find(s => s.productName === item.productName && s.typeName === item.typeName && s.status === "active");
  if (durationDays && durationDays > 0) {
    const existingExpiry = existing?.expiresAt ? new Date(existing.expiresAt).getTime() : 0;
    const base = Math.max(now, Number.isFinite(existingExpiry) ? existingExpiry : 0);
    const expiresAt = new Date(base + durationDays * 86400000).toISOString();
    if (existing) {
      existing.expiresAt = expiresAt;
      existing.durationDays = durationDays;
      existing.lastPurchaseId = purchaseId;
      existing.purchasedAt = new Date(now).toISOString();
    } else user.subscriptions.push({id:`sub_${crypto.randomUUID()}`,productName:item.productName,typeName:item.typeName,durationDays,purchasedAt:new Date(now).toISOString(),expiresAt,status:"active",purchaseId});
  } else user.subscriptions.push({id:`sub_${crypto.randomUUID()}`,productName:item.productName,typeName:item.typeName,durationDays:null,purchasedAt:new Date(now).toISOString(),expiresAt:null,status:"active",purchaseId});
}
function latestFormResponse(pending) {
  const fields = Array.isArray(pending.lastFormRequestFields) ? pending.lastFormRequestFields : [];
  const map = pending.formResponses && typeof pending.formResponses === "object" ? pending.formResponses : {};
  const entries = Object.entries(map).sort((a,b)=>new Date(b[1]?.submittedAt||0)-new Date(a[1]?.submittedAt||0));
  const latest = entries[0]?.[1];
  if (!fields.length) return {required:[], responses:{}, complete:true};
  const responses = latest?.responses && typeof latest.responses === "object" ? latest.responses : {};
  const complete = fields.every(key => String(responses[key] || "").trim());
  return {required:fields, responses, complete};
}

export default async function handler(req, res) {
  const admin = adminAuth(req);
  if (!admin) return res.status(401).json({success:false,message:"Sesi admin tidak valid atau sudah kedaluwarsa."});
  try {
    const {database,sha:databaseSha} = await readDatabase();
    database.users ||= [];
    database.users.forEach(user => {
      user.reseller = user.reseller === true;
      user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
      user.pendingPurchases = Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [];
      user.inbox = Array.isArray(user.inbox) ? user.inbox : [];
    });

    if (req.method === "GET") {
      const pending=[];
      for (const user of database.users) for (const purchase of user.pendingPurchases.filter(p=>p.status==="pending")) {
        const form=latestFormResponse(purchase);
        pending.push({...purchase,userId:user.id,username:user.username,userEmail:user.email||"",userPhone:user.phone||"",formStatus:form});
      }
      pending.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      return res.status(200).json({success:true,purchases:pending,formFields:FORM_FIELDS});
    }
    if (req.method !== "PATCH") return res.status(405).json({success:false,message:"Method tidak diizinkan."});

    const {purchaseId,userId,action} = req.body || {};
    if (!purchaseId || !userId || !["confirm","reject","requestForm"].includes(action)) return res.status(400).json({success:false,message:"Data tindakan pesanan tidak lengkap."});
    const user=database.users.find(u=>u.id===userId);
    if(!user) return res.status(404).json({success:false,message:"User tidak ditemukan."});
    const pending=(user.pendingPurchases||[]).find(p=>p.id===purchaseId);
    if(!pending) return res.status(404).json({success:false,message:"Pesanan tidak ditemukan."});
    if(pending.status!=="pending") return res.status(409).json({success:false,message:"Pesanan sudah diproses sebelumnya."});

    if(action==="requestForm"){
      const selected=[...new Set((Array.isArray(req.body?.fields)?req.body.fields:[]).map(String).filter(k=>FORM_FIELDS[k]))];
      if(!selected.length) return res.status(400).json({success:false,message:"Pilih minimal satu data yang harus diisi user."});
      const messageId=`msg_${crypto.randomUUID()}`;
      user.inbox.unshift({id:messageId,type:"form",read:false,createdAt:new Date().toISOString(),title:"Admin meminta data pesanan",body:"Admin meminta Anda melengkapi data pesanan. Tekan tombol Lengkapi Form di bawah pesan ini.",purchaseId:pending.id,fields:selected.map(key=>({key,label:FORM_FIELDS[key]})),responded:false});
      pending.lastFormRequestAt=new Date().toISOString();
      pending.lastFormRequestFields=selected;
      pending.lastFormMessageId=messageId;
      pending.formResponses ||= {};
      await writeDatabase(database,databaseSha,`Request order form ${purchaseId} for ${user.username}`);
      return res.status(200).json({success:true,message:"Form berhasil dikirim ke inbox user.",user:safeUser(user)});
    }

    const note=String(req.body?.note||"").trim().slice(0,5000);
    if(action==="reject"){
      pending.status="rejected";pending.processedAt=new Date().toISOString();pending.processedBy=admin.username;pending.adminNote=note;
      user.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"info",read:false,createdAt:new Date().toISOString(),title:"Pesanan ditolak",body:note?`Pesanan Anda ditolak oleh admin. Catatan: ${note}`:"Pesanan Anda ditolak oleh admin.",purchaseId:pending.id,note});
      let emailStatus="";
      if(user.email){try{await sendEmail({to:user.email,subject:`Update Pesanan RYY STORE — ${purchaseId}`,html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>RYY STORE</h2><p>Pesanan Anda ditolak.</p>${note?`<p><b>Catatan admin:</b><br>${htmlEscape(note).replace(/\n/g,"<br>")}</p>`:""}<p>Jika ada pertanyaan, silakan chat admin melalui RYY STORE.</p></div>`});emailStatus=" Email notifikasi dikirim.";}catch(e){console.error("Reject email error",e);emailStatus=" Email notifikasi gagal dikirim.";}}
      await writeDatabase(database,databaseSha,`Reject purchase ${purchaseId}`);
      return res.status(200).json({success:true,message:`Pesanan ditolak.${emailStatus}`,user:safeUser(user)});
    }

    const form=latestFormResponse(pending);
    if(form.required.length && !form.complete) return res.status(409).json({success:false,code:"FORM_REQUIRED",message:"Pesanan belum dapat di-ACC. User harus mengisi form yang diminta terlebih dahulu.",requiredFields:form.required});

    const productData=String(req.body?.productData||"").trim();
    const {data:catalog,sha:productsSha}=await readRepoJson(PRODUCTS_PATH);
    const products=Array.isArray(catalog?.products)?catalog.products.map(normalizeProduct):[];
    const resolved=[];
    for(const item of pending.items||[]){
      const product=products.find(p=>Number(p.id)===Number(item.id));
      if(!product) return res.status(404).json({success:false,message:`Produk ${item.productName} sudah tidak tersedia.`});
      const type=product.types.find(t=>String(t.typeName)===String(item.typeName));
      if(!type) return res.status(404).json({success:false,message:`Varian ${item.typeName} sudah tidak tersedia.`});
      if(typeStock(type)<Number(item.quantity||0)) return res.status(409).json({success:false,message:`Stok ${product.name} - ${type.typeName} tidak mencukupi. Tersisa ${typeStock(type)} unit.`});
      resolved.push({product,type,item});
    }
    let totalItems=0,totalSpent=0;
    for(const {product,type,item} of resolved){const quantity=Math.max(1,Math.floor(Number(item.quantity)||0));type.stock=typeStock(type)-quantity;product.stock=productStock(product);totalItems+=quantity;totalSpent+=Number(item.priceFinal||0)*quantity;addSubscription(user,item,pending.id);}
    user.totalItemsBought=Number(user.totalItemsBought||0)+totalItems;user.totalMoneySpent=Number(user.totalMoneySpent||0)+totalSpent;
    pending.status="confirmed";pending.processedAt=new Date().toISOString();pending.processedBy=admin.username;pending.confirmedTotalItems=totalItems;pending.confirmedTotalSpent=totalSpent;pending.adminNote=note;pending.formCompletedAt=form.required.length?new Date().toISOString():pending.formCompletedAt||"";pending.delivery={status:"pending",email:user.email||"",sentAt:""};
    const formText=Object.entries(form.responses||{}).map(([key,val])=>`${FORM_FIELDS[key]||key}: ${val}`).join("\n");
    user.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"success",read:false,createdAt:new Date().toISOString(),title:"Pesanan berhasil dikonfirmasi",body:note?`Pesanan Anda berhasil dikonfirmasi oleh admin. Catatan: ${note}`:"Pesanan Anda berhasil dikonfirmasi oleh admin.",purchaseId:pending.id,note});
    database.settings ||= {};database.settings.totalBuyers=database.users.length;database.products=products;
    await writeRepoJson(PRODUCTS_PATH,catalog,productsSha,`Confirm purchase ${purchaseId}`);
    await writeDatabase(database,databaseSha,`Confirm purchase ${purchaseId} for ${user.username}`);

    let emailStatus="";
    if(user.email){
      try{
        const itemList=(pending.items||[]).map(item=>`<li>${htmlEscape(item.productName)} — ${htmlEscape(item.typeName)} × ${Number(item.quantity||0)}</li>`).join("");
        const formBlock=formText?`<h3>Data form</h3><pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:10px">${htmlEscape(formText)}</pre>`:"";
        const productBlock=productData?`<h3>Data produk</h3><pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:10px">${htmlEscape(productData)}</pre>`:"";
        const noteBlock=note?`<p><b>Catatan admin:</b><br>${htmlEscape(note).replace(/\n/g,"<br>")}</p>`:"";
        await sendEmail({to:user.email,subject:`Pesanan RYY STORE dikonfirmasi — ${purchaseId}`,html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>RYY STORE</h2><p>Pesanan Anda telah dikonfirmasi.</p><ul>${itemList}</ul>${noteBlock}${formBlock}${productBlock}<p>Terima kasih telah berbelanja di RYY STORE.</p></div>`});
        pending.delivery={status:"sent",email:user.email,sentAt:new Date().toISOString()};
        const latest=await readDatabase();const latestUser=(latest.database.users||[]).find(u=>u.id===user.id);const latestPurchase=latestUser?.pendingPurchases?.find(p=>p.id===purchaseId);if(latestPurchase)latestPurchase.delivery=pending.delivery;if(latestUser){latestUser.inbox ||= [];latestUser.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"success",read:false,createdAt:new Date().toISOString(),title:"Hasil pesanan sudah dikirim ke email",body:`Data hasil pesanan telah dikirim ke ${user.email}.`,purchaseId});await writeDatabase(latest.database,latest.sha,`Mark email delivery ${purchaseId}`);}emailStatus=` Data pesanan dikirim ke ${user.email}.`;
      }catch(e){console.error("Product data email error",e);pending.delivery={status:"failed",email:user.email,sentAt:"",error:"Email gagal dikirim"};emailStatus=" Email hasil pesanan belum berhasil dikirim.";}
    } else emailStatus=" User belum memiliki email, sehingga hasil pesanan hanya tersedia di inbox.";

    return res.status(200).json({success:true,message:`Pembelian dikonfirmasi.${emailStatus}`,user:safeUser(user),products});
  }catch(error){console.error("Admin purchases error:",error);return res.status(500).json({success:false,message:error?.message||"Gagal memproses konfirmasi pembelian."});}
}
