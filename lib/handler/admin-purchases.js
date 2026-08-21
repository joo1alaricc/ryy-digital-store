import crypto from "node:crypto";
import { readDatabase, writeDatabase, readRepoJson, writeRepoJson } from "../_github.js";
import { verifyAdminToken } from "../_admin.js";
import { normalizeProduct, productStock, typeStock, safeUser } from "../_store.js";
import { sendEmail } from "../_gmail.js";

const PRODUCTS_PATH = "produk.json";

const FORM_FIELDS = {
  email: "Email",
  phone: "Nomor telepon",
  emailPassword: "Password Email",
  mlId: "ID ML",
  ffId: "ID FF",
  meterNumber: "Nomor meter",
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
  const durationDays = item.durationDays === null || item.durationDays === undefined
    ? null
    : Number(item.durationDays);

  const existing = user.subscriptions.find(s =>
    s.productName === item.productName && s.typeName === item.typeName && s.status === "active"
  );

  if (durationDays && durationDays > 0) {
    const existingExpiry = existing?.expiresAt ? new Date(existing.expiresAt).getTime() : 0;
    const base = Math.max(now, Number.isFinite(existingExpiry) ? existingExpiry : 0);
    const expiresAt = new Date(base + durationDays * 24 * 60 * 60 * 1000).toISOString();

    if (existing) {
      existing.expiresAt = expiresAt;
      existing.durationDays = durationDays;
      existing.lastPurchaseId = purchaseId;
      existing.purchasedAt = new Date(now).toISOString();
    } else {
      user.subscriptions.push({
        id: `sub_${crypto.randomUUID()}`,
        productName: item.productName,
        typeName: item.typeName,
        durationDays,
        purchasedAt: new Date(now).toISOString(),
        expiresAt,
        status: "active",
        purchaseId
      });
    }
  } else {
    user.subscriptions.push({
      id: `sub_${crypto.randomUUID()}`,
      productName: item.productName,
      typeName: item.typeName,
      durationDays: null,
      purchasedAt: new Date(now).toISOString(),
      expiresAt: null,
      status: "active",
      purchaseId
    });
  }
}

export default async function handler(req, res) {
  const admin = adminAuth(req);
  if (!admin) return res.status(401).json({ success:false, message:"Sesi admin tidak valid atau sudah kedaluwarsa." });

  try {
    const { database, sha: databaseSha } = await readDatabase();
    database.users ||= [];
    database.users.forEach(user => {
      user.reseller = user.reseller === true;
      user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
      user.pendingPurchases = Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [];
  user.inbox = Array.isArray(user.inbox) ? user.inbox : [];
    });

    if (req.method === "GET") {
      const pending = [];
      database.users.forEach(user => {
        user.pendingPurchases
          .filter(p => p.status === "pending")
          .forEach(purchase => pending.push({
            ...purchase,
            userId: user.id,
            username: user.username,
            userEmail: user.email || "",
            userPhone: user.phone || ""
          }));
      });
      pending.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.status(200).json({ success:true, purchases:pending });
    }

    if (req.method !== "PATCH") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });

    const { purchaseId, userId, action } = req.body || {};
    if (!purchaseId || !userId || !["confirm","reject","requestForm"].includes(action)) {
      return res.status(400).json({ success:false, message:"Data tindakan pesanan tidak lengkap." });
    }

    const userIndex = database.users.findIndex(u => u.id === userId);
    if (userIndex < 0) return res.status(404).json({ success:false, message:"User tidak ditemukan." });

    const user = database.users[userIndex];
    const pending = user.pendingPurchases.find(p => p.id === purchaseId);
    if (!pending) return res.status(404).json({ success:false, message:"Pesanan tidak ditemukan." });
    if (pending.status !== "pending") return res.status(409).json({ success:false, message:"Pesanan sudah diproses sebelumnya." });

    if (action === "requestForm") {
      const selectedFields = Array.isArray(req.body?.fields) ? req.body.fields.map(String).filter(key => FORM_FIELDS[key]) : [];
      const uniqueFields = [...new Set(selectedFields)];
      if (!uniqueFields.length) return res.status(400).json({ success:false, message:"Pilih minimal satu form yang harus diisi user." });
      const messageId = `msg_${crypto.randomUUID()}`;
      const fields = uniqueFields.map(key => ({ key, label: FORM_FIELDS[key] }));
      user.inbox.unshift({
        id:messageId, type:"form", read:false, createdAt:new Date().toISOString(),
        title:"Lengkapi data pesanan",
        body:"Admin meminta Anda melengkapi data berikut. Tekan tombol di bawah untuk mengisi form.",
        purchaseId:pending.id, fields, responded:false
      });
      pending.lastFormRequestAt = new Date().toISOString();
      pending.lastFormRequestFields = uniqueFields;
      await writeDatabase(database, databaseSha, `Request form ${purchaseId} for ${user.username}`);
      return res.status(200).json({ success:true, message:"Form berhasil dikirim ke inbox user.", user:safeUser(user) });
    }

    if (action === "reject") {
      pending.status = "rejected";
      pending.processedAt = new Date().toISOString();
      pending.processedBy = admin.username;
      user.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"info",read:false,createdAt:new Date().toISOString(),title:"Pesanan ditolak",body:"Pesanan Anda ditolak oleh admin. Silakan hubungi admin melalui layanan toko jika membutuhkan bantuan.",purchaseId:pending.id});
      await writeDatabase(database, databaseSha, `Reject purchase ${purchaseId}`);
      return res.status(200).json({ success:true, message:"Pesanan ditolak.", user:safeUser(user) });
    }

    const productData = String(req.body?.productData || "").trim();
    const { data: catalog, sha: productsSha } = await readRepoJson(PRODUCTS_PATH);
    const products = Array.isArray(catalog?.products) ? catalog.products.map(normalizeProduct) : [];

    // Re-check every type stock before changing anything.
    const resolved = [];
    for (const item of pending.items || []) {
      const product = products.find(p => Number(p.id) === Number(item.id));
      if (!product) return res.status(404).json({ success:false, message:`Produk ${item.productName} sudah tidak tersedia.` });
      const type = product.types.find(t => String(t.typeName) === String(item.typeName));
      if (!type) return res.status(404).json({ success:false, message:`Varian ${item.typeName} sudah tidak tersedia.` });
      if (typeStock(type) < Number(item.quantity || 0)) {
        return res.status(409).json({ success:false, message:`Stok ${product.name} - ${type.typeName} tidak mencukupi. Tersisa ${typeStock(type)} unit.` });
      }
      resolved.push({ product, type, item });
    }

    let totalItems = 0;
    let totalSpent = 0;
    for (const { product, type, item } of resolved) {
      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
      type.stock = typeStock(type) - quantity;
      product.stock = productStock(product);
      totalItems += quantity;
      totalSpent += Number(item.priceFinal || 0) * quantity;
      addSubscription(user, item, pending.id);
    }

    user.totalItemsBought = Number(user.totalItemsBought || 0) + totalItems;
    user.totalMoneySpent = Number(user.totalMoneySpent || 0) + totalSpent;

    pending.status = "confirmed";
    pending.processedAt = new Date().toISOString();
    pending.processedBy = admin.username;
    pending.confirmedTotalItems = totalItems;
    pending.confirmedTotalSpent = totalSpent;
    pending.delivery = { status:"pending", email:user.email||"", sentAt:"" };

    user.inbox.unshift({
      id:`msg_${crypto.randomUUID()}`, type:"success", read:false, createdAt:new Date().toISOString(),
      title:"Pesanan berhasil dikonfirmasi",
      body:"Pesanan Anda berhasil dikonfirmasi oleh admin.",
      purchaseId:pending.id
    });

    database.settings ||= {};
    database.settings.totalBuyers = database.users.length;
    database.products = products;

    await writeRepoJson(PRODUCTS_PATH, catalog, productsSha, `Confirm purchase ${purchaseId}`);
    await writeDatabase(database, databaseSha, `Confirm purchase ${purchaseId} for ${user.username}`);

    let emailStatus = "";
    if (productData && user.email) {
      try {
        const itemList = (pending.items || []).map(item => `<li>${htmlEscape(item.productName)} — ${htmlEscape(item.typeName)} × ${Number(item.quantity || 0)}</li>`).join("");
        await sendEmail({
          to:user.email,
          subject:`Data Pesanan RYY STORE — ${purchaseId}`,
          html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222"><h2>RYY STORE</h2><p>Pesanan Anda telah dikonfirmasi.</p><p><b>Detail pesanan:</b></p><ul>${itemList}</ul><p><b>Data produk:</b></p><pre style="white-space:pre-wrap;background:#f5f5f5;padding:14px;border-radius:10px">${htmlEscape(productData)}</pre><p>Terima kasih telah berbelanja di RYY STORE.</p></div>`
        });
        pending.delivery = { status:"sent", email:user.email, sentAt:new Date().toISOString() };
        emailStatus = ` Data produk dikirim ke ${user.email}.`;
        const latest = await readDatabase();
        const latestUser = (latest.database.users || []).find(u => u.id === user.id);
        const latestPurchase = latestUser?.pendingPurchases?.find(p => p.id === purchaseId);
        if (latestPurchase) latestPurchase.delivery = pending.delivery;
        if (latestUser) {
          latestUser.inbox ||= [];
          latestUser.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"success",read:false,createdAt:new Date().toISOString(),title:"Data produk sudah dikirim",body:`Data berhasil di kirim ke ${user.email}, silakan cek.`,purchaseId});
          await writeDatabase(latest.database, latest.sha, `Mark email delivery ${purchaseId}`);
        }
      } catch (emailError) {
        console.error("Product data email error:", emailError);
        pending.delivery = { status:"failed", email:user.email||"", sentAt:"", error:"Email gagal dikirim" };
        emailStatus = " Email belum berhasil dikirim; cek konfigurasi Gmail.";
        try {
          const latest = await readDatabase();
          const latestUser = (latest.database.users || []).find(u => u.id === user.id);
          const latestPurchase = latestUser?.pendingPurchases?.find(p => p.id === purchaseId);
          if (latestPurchase) latestPurchase.delivery = pending.delivery;
          if (latestUser) {
            latestUser.inbox ||= [];
            latestUser.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:"info",read:false,createdAt:new Date().toISOString(),title:"Email data belum terkirim",body:"Data produk belum berhasil dikirim ke email. Silakan cek kembali atau hubungi admin.",purchaseId});
            await writeDatabase(latest.database, latest.sha, `Mark email delivery failed ${purchaseId}`);
          }
        } catch (_) {}
      }
    } else if (productData && !user.email) {
      emailStatus = " User belum memiliki email, jadi data produk belum dapat dikirim lewat Gmail.";
    }

    return res.status(200).json({
      success:true,
      message:`Pembelian dikonfirmasi. Stok, total pembelian, dan langganan user telah diperbarui.${emailStatus}`,
      user:safeUser(user),
      products
    });
  } catch (error) {
    console.error("Admin purchases error:", error);
    return res.status(500).json({ success:false, message:"Gagal memproses konfirmasi pembelian." });
  }
}
