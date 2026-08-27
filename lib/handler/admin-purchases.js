import crypto from "node:crypto";
import { readDatabase, writeDatabase, readRepoJson, writeRepoJson, readKVJson, writeKVJson, readJsonAsset } from "../_github.js";
import { verifyAdminToken, isMainAdmin } from "../_admin.js";
import { getMainGateway, getGatewayByAdmin, sendGatewayText, buildApprovalNotification } from "../_whatsapp.js";
import { normalizeProduct, normalizeCatalog, productStock, typeStock, safeUser } from "../_store.js";
import { sendEmail } from "../_gmail.js";
import { ensureWallet, refundCoins, unmarkStarterOffer } from "../_finance.js";
import { readVouchers, writeVouchers } from "./voucher.js";

const PRODUCTS_PATH = "produk.json";
const PRODUCTS_KV_KEY = "ryy:products:v1";

const FORM_FIELDS = {
  email: "Email",
  emailPassword: "Password Email",
  mlId: "ID ML",
  ffId: "ID FF",
  meterNumber: "Nomor meter",
  phone: "Nomor telepon",
  usntele: "Username Telegram",
  idtele: "ID Telegram",
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
      if(pending.walletPayment){
        const wallet=ensureWallet(user);
        refundCoins(user,Number(pending.totalCoins||0),'Refund pesanan saldo RYY',{purchaseId:pending.id});
        for(const item of pending.items||[]) if(item.starterOffer) unmarkStarterOffer(user,item.productName,item.typeName,'pending');
        if(pending.cashbackId){ wallet.cashbackPending=wallet.cashbackPending.filter(x=>x.id!==pending.cashbackId); }
        if(pending.voucherId){ const vd=await readVouchers(); const v=vd.vouchers.find(x=>x.id===pending.voucherId); if(v){v.uses=Math.max(0,Number(v.uses||0)-1);v.active=true;await writeVouchers(vd);} }
      }
      pending.status="rejected";pending.processedAt=new Date().toISOString();pending.processedBy=admin.username;pending.adminNote=note;
      user.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"info",read:false,createdAt:new Date().toISOString(),title:"Pesanan ditolak",body:note?`Pesanan Anda ditolak oleh admin. Catatan: ${note}`:"Pesanan Anda ditolak oleh admin.",purchaseId:pending.id,note});
      let emailStatus="";
      if(user.email){try{await sendEmail({to:user.email,subject:`Update Pesanan RYY STORE — ${purchaseId}`,html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>RYY STORE</h2><p>Pesanan Anda ditolak.</p>${note?`<p><b>Catatan admin:</b><br>${htmlEscape(note).replace(/\n/g,"<br>")}</p>`:""}<p>Jika ada pertanyaan, silakan chat admin melalui RYY STORE.</p></div>`});emailStatus=" Email notifikasi dikirim.";}catch(e){console.error("Reject email error",e);emailStatus=" Email notifikasi gagal dikirim.";}}
      await writeDatabase(database,databaseSha,`Reject purchase ${purchaseId}`);
      return res.status(200).json({success:true,message:`Pesanan ditolak.${emailStatus}`,user:safeUser(user)});
    }

    const form=latestFormResponse(pending);
    if(pending.paymentMethod==='QRIS' && pending.paymentStatus!=='paid') return res.status(409).json({success:false,code:"PAYMENT_PENDING",message:"Pembayaran QRIS belum terdeteksi sebagai berhasil. Tunggu konfirmasi gateway terlebih dahulu."});
    if(form.required.length && !form.complete) return res.status(409).json({success:false,code:"FORM_REQUIRED",message:"Pesanan belum dapat di-ACC. User harus mengisi form yang diminta terlebih dahulu.",requiredFields:form.required});

    // Product approval must use the same KV-first catalog strategy as the rest of the app.
    // GitHub is only an optional backup, never a prerequisite for approving an order.
    let catalog = await readKVJson(PRODUCTS_KV_KEY);
    let productsSha = null;
    if (!catalog || typeof catalog !== "object") {
      catalog = await readJsonAsset(PRODUCTS_PATH);
      if (!catalog || typeof catalog !== "object") {
        try {
          const gh = await readRepoJson(PRODUCTS_PATH);
          catalog = gh.data;
          productsSha = gh.sha;
        } catch (e) {
          console.warn("Approve purchase: product GitHub fallback unavailable:", e?.message || e);
        }
      }
      if (catalog && typeof catalog === "object") {
        try { await writeKVJson(PRODUCTS_KV_KEY, catalog); }
        catch (e) { console.warn("Approve purchase: failed to seed product KV:", e?.message || e); }
      }
    }
    if (!catalog || typeof catalog !== "object") return res.status(503).json({success:false,message:"Katalog produk tidak tersedia di runtime Cloudflare."});
    normalizeCatalog(catalog);
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
    for(const {product,type,item} of resolved){const quantity=Math.max(1,Math.floor(Number(item.quantity)||0));type.stock=typeStock(type)-quantity;product.stock=productStock(product);totalItems+=quantity;totalSpent+=Number(item.priceFinal||0)*quantity;addSubscription(user,item,pending.id); if(item.starterOffer){const wallet=ensureWallet(user);const used=wallet.starterOfferUsed.find(x=>x.name===item.productName&&x.type===item.typeName&&x.purchaseId==='pending');if(used)used.purchaseId=pending.id;}}
    user.totalItemsBought=Number(user.totalItemsBought||0)+totalItems;user.totalMoneySpent=Number(user.totalMoneySpent||0)+totalSpent;
    pending.status="confirmed";pending.processedAt=new Date().toISOString();pending.processedBy=admin.username;pending.processedByEmail=admin.email||"";pending.processedByAdminId=admin.username;pending.confirmedTotalItems=totalItems;pending.confirmedTotalSpent=totalSpent;pending.adminNote=note;pending.formCompletedAt=form.required.length?new Date().toISOString():pending.formCompletedAt||"";pending.delivery={status:"pending",email:user.email||"",sentAt:""};
    const formText=Object.entries(form.responses||{}).map(([key,val])=>`${FORM_FIELDS[key]||key}: ${val}`).join("\n");
    user.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"success",read:false,createdAt:new Date().toISOString(),title:"Pesanan berhasil dikonfirmasi",body:note?`Pesanan Anda berhasil dikonfirmasi oleh admin. Catatan: ${note}`:"Pesanan Anda berhasil dikonfirmasi oleh admin.",purchaseId:pending.id,note});
    // After ACC, create a dedicated screenshot request in the user's Inbox.
    const screenshotMessageId=`msg_${crypto.randomUUID()}`;
    user.inbox.unshift({
      id:screenshotMessageId,type:"image",read:false,createdAt:new Date().toISOString(),
      title:"Verifikasi Login",body:`Pesanan #${pending.id} telah diproses. Silakan upload screenshot halaman login Anda.`,
      purchaseId:pending.id,responded:false,accept:"image/jpeg,image/png,image/webp"
    });
    pending.loginScreenshotRequestId=screenshotMessageId;
    database.settings ||= {};database.settings.totalBuyers=database.users.length;database.products=products;
    // Persist the stock change to KV first. A GitHub sync is best-effort only.
    await writeKVJson(PRODUCTS_KV_KEY, catalog);
    try {
      const latest = productsSha ? { sha: productsSha } : await readRepoJson(PRODUCTS_PATH);
      await writeRepoJson(PRODUCTS_PATH, catalog, latest.sha, `Confirm purchase ${purchaseId}`);
    } catch (e) {
      console.warn("Approve purchase: GitHub backup skipped:", e?.message || e);
    }
    await writeDatabase(database,databaseSha,`Confirm purchase ${purchaseId} for ${user.username}`);

    let emailStatus="";
    if(user.email){
      try{
        const itemList=(pending.items||[]).map(item=>{const options=Array.isArray(item.options)&&item.options.length?`<br>Opsi: ${htmlEscape(item.options.join(', '))}`:"";const params=item.parameters&&typeof item.parameters==='object'?Object.entries(item.parameters).map(([k,v])=>`${htmlEscape(k)}: ${htmlEscape(v)}`).join('<br>'):"";return `<li>${htmlEscape(item.productName)} — ${htmlEscape(item.typeName)} × ${Number(item.quantity||0)}${options}${params?`<br>${params}`:""}</li>`;}).join("");
        const formBlock=formText?`<h3>Data form</h3><pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:10px">${htmlEscape(formText)}</pre>`:"";
        const productData=String(req.body?.productData||"").trim(); const productBlock=productData?`<h3>Data produk</h3><pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:10px">${htmlEscape(productData)}</pre>`:"";
        const noteBlock=note?`<p><b>Catatan admin:</b><br>${htmlEscape(note).replace(/\n/g,"<br>")}</p>`:"";
        await sendEmail({to:user.email,subject:`Pesanan RYY STORE dikonfirmasi — ${purchaseId}`,html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>RYY STORE</h2><p>Pesanan Anda telah dikonfirmasi.</p><ul>${itemList}</ul>${noteBlock}${formBlock}${productBlock}<p>Terima kasih telah berbelanja di RYY STORE.</p></div>`});
        pending.delivery={status:"sent",email:user.email,sentAt:new Date().toISOString()};
        const latest=await readDatabase();const latestUser=(latest.database.users||[]).find(u=>u.id===user.id);const latestPurchase=latestUser?.pendingPurchases?.find(p=>p.id===purchaseId);if(latestPurchase)latestPurchase.delivery=pending.delivery;if(latestUser){latestUser.inbox ||= [];latestUser.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"success",read:false,createdAt:new Date().toISOString(),title:"Hasil pesanan sudah dikirim ke email",body:`Data hasil pesanan telah dikirim ke ${user.email}.`,purchaseId});await writeDatabase(latest.database,latest.sha,`Mark email delivery ${purchaseId}`);}emailStatus=` Data pesanan dikirim ke ${user.email}.`;
      }catch(e){console.error("Product data email error",e);pending.delivery={status:"failed",email:user.email,sentAt:"",error:"Email gagal dikirim"};emailStatus=" Email hasil pesanan belum berhasil dikirim.";}
    } else emailStatus=" User belum memiliki email, sehingga hasil pesanan hanya tersedia di inbox.";

    let approvalNotifyStatus = "";
    if (!isMainAdmin(admin)) {
      const approvalText = buildApprovalNotification(purchaseId, admin);
      try {
        await Promise.all([
          sendEmail({
            to:"rizaladitia992@gmail.com",
            subject:`ACC Pesanan ${purchaseId} oleh ${admin.username}`,
            html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>RYY STORE</h2><p>${htmlEscape(approvalText).replace(/\n/g,"<br>")}</p></div>`
          }),
          sendEmail({
            to:"eilyansander@gmail.com",
            subject:`ACC Pesanan ${purchaseId} oleh ${admin.username}`,
            html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>RYY STORE</h2><p>${htmlEscape(approvalText).replace(/\n/g,"<br>")}</p></div>`
          })
        ]);
        approvalNotifyStatus += " Email notifikasi ACC dikirim.";
      } catch (notifyError) {
        console.error("ACC approval email notification error:", notifyError);
        approvalNotifyStatus += " Email notifikasi ACC gagal dikirim.";
      }
      try {
        const mainGateway = await getMainGateway();
        if (mainGateway?.ownerPhone) {
          await sendGatewayText(mainGateway, mainGateway.ownerPhone, approvalText);
          approvalNotifyStatus += " WhatsApp admin utama dikirim.";
        } else {
          approvalNotifyStatus += " Gateway admin utama belum siap.";
        }
      } catch (notifyError) {
        console.error("ACC approval WhatsApp notification error:", notifyError);
        approvalNotifyStatus += " WhatsApp admin utama gagal dikirim.";
      }
    }

    return res.status(200).json({success:true,message:`Pembelian dikonfirmasi.${emailStatus}${approvalNotifyStatus}`,user:safeUser(user),products});
  }catch(error){console.error("Admin purchases error:",error);return res.status(500).json({success:false,message:error?.message||"Gagal memproses konfirmasi pembelian."});}
}
