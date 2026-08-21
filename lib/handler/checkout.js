import { readDatabase, writeDatabase, readRepoJson } from "../_github.js";
import { verifyUserToken } from "../_auth.js";
import { normalizeProduct, resellerPrice, safeUser, typeStock } from "../_store.js";
import crypto from "node:crypto";
import { isValidUploadedImageUrl } from "../_image-upload.js";

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });

    try {
        const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const session = verifyUserToken(token);
        if (!session) return res.status(401).json({ success:false, message:"Sesi user tidak valid atau sudah kedaluwarsa." });

        const { database, sha } = await readDatabase();
        database.users ||= [];
        const user = database.users.find(u => u.id === session.userId);
        if (!user) return res.status(404).json({ success:false, message:"User tidak ditemukan." });

        user.reseller = user.reseller === true;
        user.pendingPurchases = Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [];
        user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
        user.inbox = Array.isArray(user.inbox) ? user.inbox : [];

        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const targetPhone = String(req.body?.targetPhone || "").trim();
        const paymentMethod = String(req.body?.paymentMethod || "").trim();
        const proofUrl = String(req.body?.proofUrl || "").trim();
        if (!items.length || !targetPhone || !paymentMethod || !proofUrl) {
            return res.status(400).json({ success:false, message:"Produk, nomor penerima, metode pembayaran, dan bukti pembayaran wajib diisi." });
        }
        if (!isValidUploadedImageUrl(proofUrl)) return res.status(400).json({ success:false, message:"URL bukti pembayaran tidak valid." });

        const { data: catalog } = await readRepoJson("produk.json");
        const products = Array.isArray(catalog?.products) ? catalog.products.map(normalizeProduct) : [];
        const pendingItems = [];

        for (const raw of items) {
            const product = products.find(p => Number(p.id) === Number(raw.id));
            if (!product) return res.status(404).json({ success:false, message:`Produk ID ${raw.id} tidak ditemukan.` });
            const typeName = String(raw.typeName || "");
            const type = product.types.find(t => String(t.typeName) === typeName);
            if (!type) return res.status(400).json({ success:false, message:`Varian ${typeName} tidak ditemukan pada ${product.name}.` });

            const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 0));
            if (typeStock(type) < quantity) {
                return res.status(409).json({ success:false, message:`Stok ${product.name} - ${typeName} tidak mencukupi.` });
            }

            const original = Number(type.price || 0);
            pendingItems.push({
                id:Number(product.id),
                productName:String(product.name || ""),
                typeName,
                quantity,
                priceOriginal:original,
                priceFinal:resellerPrice(original,user),
                durationDays:type.durationDays ?? null
            });
        }

        const pending = {
            id:`purchase_${crypto.randomUUID()}`,
            status:"pending",
            createdAt:new Date().toISOString(),
            targetPhone,
            paymentMethod,
            reseller:user.reseller === true,
            totalItems:pendingItems.reduce((s,i)=>s+i.quantity,0),
            totalSpent:pendingItems.reduce((s,i)=>s+i.priceFinal*i.quantity,0),
            items:pendingItems,
            proofUrl,
            formResponses: {}
        };

        user.pendingPurchases.unshift(pending);
        user.inbox.unshift({
            id:`msg_${crypto.randomUUID()}`, type:"info", read:false, createdAt:new Date().toISOString(),
            title:"Pesanan masuk sesi menunggu",
            body:"Bukti pembayaran berhasil diterima. Pesanan Anda sedang menunggu pemeriksaan admin.",
            purchaseId:pending.id
        });
        await writeDatabase(database, sha, `Pending checkout ${user.username} - ${pending.id}`);

        return res.status(200).json({
            success:true,
            message:"Checkout dicatat dan menunggu konfirmasi admin. Stok belum dikurangi.",
            user:safeUser(user),
            pendingPurchase:pending
        });
    } catch (error) {
        console.error("Checkout pending error:", error);
        return res.status(500).json({ success:false, message:"Gagal menyimpan sesi checkout." });
    }
}
