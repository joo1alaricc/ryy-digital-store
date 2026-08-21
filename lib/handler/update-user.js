import crypto from "node:crypto";
import { readDatabase, writeDatabase, readRepoJson } from "../_github.js";
import { hashPassword, verifyPassword, verifyUserToken, verifyOTPToken } from "../_auth.js";
import { normalizeProduct, productStock, resellerPrice, safeUser, typeStock } from "../_store.js";
import { isValidUploadedImageUrl } from "../_image-upload.js";

const PRODUCTS_PATH = "produk.json";

function ensureUserCollections(user) {
  user.reseller = user.reseller === true;
  user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
  user.pendingPurchases = Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [];
}

function calculateRemainingTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.priceFinal || 0) * Number(item.quantity || 0), 0);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });

  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const session = verifyUserToken(token);
    const { userId, action } = req.body || {};

    if (!session || session.userId !== userId) return res.status(401).json({ success:false, message:"Sesi user tidak valid atau sudah kedaluwarsa." });
    if (!userId || !action) return res.status(400).json({ success:false, message:"Data tidak lengkap." });

    const { database, sha } = await readDatabase();
    database.users ||= [];
    const index = database.users.findIndex(user => user.id === userId);
    if (index === -1) return res.status(404).json({ success:false, message:"User tidak ditemukan." });

    const user = database.users[index];
    ensureUserCollections(user);

    if (action === "avatar") {
      const avatar = String(req.body.avatar || "");
      if (avatar && !isValidUploadedImageUrl(avatar)) {
        return res.status(400).json({ success:false, message:"Foto profil tidak valid." });
      }
      if (avatar.length > 900000) return res.status(400).json({ success:false, message:"Foto profil terlalu besar." });
      user.avatar = avatar;
    } else if (action === "profile") {
      const secondaryContact = String(req.body.secondaryContact || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secondaryContact)) return res.status(400).json({ success:false, message:"Kontak tambahan harus berupa email yang valid." });
      if (!verifyOTPToken(req.body.otp, secondaryContact, req.body.otpToken)) return res.status(400).json({ success:false, message:"OTP kontak tambahan salah atau sudah kedaluwarsa." });
      user.secondaryContact = secondaryContact;
    } else if (action === "password") {
      const { oldPassword, newPassword } = req.body;
      if (!verifyPassword(oldPassword, user.passwordHash)) return res.status(400).json({ success:false, message:"Kata sandi lama salah." });
      if (!newPassword || newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword)) {
        return res.status(400).json({ success:false, message:"Kata sandi baru tidak memenuhi standar." });
      }
      user.passwordHash = hashPassword(newPassword);
    } else if (action === "create_pending_purchase") {
      const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
      if (!rawItems.length) return res.status(400).json({ success:false, message:"Produk checkout kosong." });

      const { data: catalog, sha: productsSha } = await readRepoJson(PRODUCTS_PATH);
      const products = Array.isArray(catalog?.products) ? catalog.products.map(normalizeProduct) : [];
      if (!products.length) return res.status(500).json({ success:false, message:"Katalog produk kosong." });

      const items = [];
      for (const raw of rawItems) {
        const product = products.find(p => Number(p.id) === Number(raw.id));
        if (!product) return res.status(404).json({ success:false, message:`Produk ID ${raw.id} tidak ditemukan.` });

        const typeName = String(raw.typeName || "");
        const type = product.types.find(t => String(t.typeName) === typeName);
        if (!type) return res.status(400).json({ success:false, message:`Varian ${typeName} tidak ditemukan pada ${product.name}.` });

        const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 0));
        if (typeStock(type) < quantity) {
          return res.status(409).json({ success:false, message:`Stok ${product.name} - ${typeName} tidak mencukupi. Tersisa ${typeStock(type)} unit.` });
        }

        const priceOriginal = Math.max(0, Number(type.price) || 0);
        const priceFinal = resellerPrice(priceOriginal, user);
        items.push({
          id: Number(product.id),
          productName: String(product.name || ""),
          typeName,
          quantity,
          priceOriginal,
          priceFinal,
          durationDays: type.durationDays ?? null
        });
      }

      const targetPhone = String(req.body.targetPhone || "").trim();
      const paymentMethod = String(req.body.paymentMethod || "").trim();
      if (!targetPhone || !paymentMethod) return res.status(400).json({ success:false, message:"Nomor penerima dan metode pembayaran wajib diisi." });

      const pending = {
        id: `purchase_${crypto.randomUUID()}`,
        status: "pending",
        createdAt: new Date().toISOString(),
        targetPhone,
        paymentMethod,
        reseller: user.reseller === true,
        totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
        totalSpent: calculateRemainingTotal(items),
        items
      };

      user.pendingPurchases.unshift(pending);
      await writeDatabase(database, sha, `Pending purchase ${user.username} - ${pending.id}`);

      return res.status(200).json({
        success:true,
        message:"Pesanan disimpan dan menunggu konfirmasi admin.",
        user:safeUser(user),
        pendingPurchase:pending
      });
    } else if (action === "purchase") {
      // Keamanan kompatibilitas: pembelian tidak boleh lagi dihitung dari client.
      return res.status(409).json({ success:false, message:"Pembelian harus melalui sesi konfirmasi admin." });
    } else {
      return res.status(400).json({ success:false, message:"Action tidak dikenal." });
    }

    await writeDatabase(database, sha, `Update user ${user.username}`);
    return res.status(200).json({ success:true, message:"Data berhasil diperbarui.", user:safeUser(user) });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ success:false, message:"Gagal memperbarui database." });
  }
}
