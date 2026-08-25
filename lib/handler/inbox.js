import crypto from "node:crypto";
import { readDatabase, writeDatabase } from "../_github.js";
import { verifyUserToken } from "../_auth.js";
import { safeUser } from "../_store.js";
import { getGatewayByAdmin, sendGatewayImage } from "../_whatsapp.js";
import { isValidUploadedImageUrl } from "../_image-upload.js";

function auth(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyUserToken(token);
}

function ensureUser(user) {
  user.inbox = Array.isArray(user.inbox) ? user.inbox : [];
  user.pendingPurchases = Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [];
}

export default async function handler(req, res) {
  const session = auth(req);
  if (!session) return res.status(401).json({ success:false, message:"Sesi user tidak valid atau sudah kedaluwarsa." });
  try {
    const { database, sha } = await readDatabase();
    const user = (database.users || []).find(u => u.id === session.userId);
    if (!user) return res.status(404).json({ success:false, message:"User tidak ditemukan." });
    ensureUser(user);

    if (req.method === "GET") {
      return res.status(200).json({ success:true, inbox:user.inbox, user:safeUser(user) });
    }
    if (req.method !== "POST") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });

    const action = String(req.body?.action || "");
    if (action === "readAll") {
      user.inbox.forEach(message => { message.read = true; });
    } else if (action === "submitScreenshot") {
      const messageId = String(req.body?.messageId || "");
      const purchaseId = String(req.body?.purchaseId || "");
      const imageUrl = String(req.body?.imageUrl || "").trim();
      const message = user.inbox.find(m => String(m.id) === messageId);
      if (!message || message.type !== "image") return res.status(404).json({ success:false, message:"Permintaan screenshot inbox tidak ditemukan." });
      if (message.responded === true) return res.status(409).json({ success:false, message:"Screenshot ini sudah pernah dikirim." });
      if (!purchaseId || String(message.purchaseId) !== purchaseId) return res.status(400).json({success:false,message:"Pesanan screenshot tidak cocok."});
      if (!isValidUploadedImageUrl(imageUrl)) return res.status(400).json({success:false,message:"URL screenshot tidak valid."});
      const purchase = user.pendingPurchases.find(p => p.id === purchaseId);
      if (!purchase || purchase.status !== "confirmed") return res.status(409).json({success:false,message:"Pesanan belum dikonfirmasi."});

      purchase.loginScreenshotUrl = imageUrl;
      purchase.loginScreenshotAt = new Date().toISOString();
      message.responded = true;
      message.read = true;
      message.imageUrl = imageUrl;
      message.respondedAt = new Date().toISOString();

      const gateway = await getGatewayByAdmin({
        username: purchase.processedBy || "",
        email: purchase.processedByEmail || ""
      });
      if (!gateway) return res.status(503).json({success:false,message:"Gateway WhatsApp admin yang menangani pesanan belum dikonfigurasi. Screenshot belum dikirim."});
      const caption = `VERIFIKASI LOGIN

Order ID: #${purchaseId}
Username User: ${user.username}
Admin Penangan: ${purchase.processedBy || "-"}

Screenshot halaman login user terlampir.`;
      let whatsappResult;
      try {
        whatsappResult = await sendGatewayImage(gateway, gateway.ownerPhone, imageUrl, caption);
      } catch (error) {
        console.error("Inbox screenshot WhatsApp error:", error);
        return res.status(502).json({success:false,message:"Screenshot tersimpan, tetapi gagal diteruskan ke WhatsApp admin.",detail:error?.message||""});
      }
      purchase.loginScreenshotDelivery = {status:"sent",gatewayId:gateway.id,ownerPhone:gateway.ownerPhone,sentAt:new Date().toISOString()};
      await writeDatabase(database, sha, `Submit login screenshot ${purchaseId}`);
      return res.status(200).json({success:true,message:"Screenshot berhasil dikirim ke WhatsApp admin.",user:safeUser(user),inbox:user.inbox,whatsapp:whatsappResult});
    } else if (action === "submitForm") {
      const messageId = String(req.body?.messageId || "");
      const purchaseId = String(req.body?.purchaseId || "");
      const responses = req.body?.responses && typeof req.body.responses === "object" ? req.body.responses : {};
      const message = user.inbox.find(m => String(m.id) === messageId);
      if (!message || message.type !== "form") return res.status(404).json({ success:false, message:"Form inbox tidak ditemukan." });
      if (message.responded === true) return res.status(409).json({ success:false, message:"Form ini sudah pernah dikirim." });
      const fields = Array.isArray(message.fields) ? message.fields : [];
      for (const field of fields) {
        if (!String(responses[field.key] || "").trim()) return res.status(400).json({ success:false, message:`${field.label} wajib diisi.` });
      }
      const purchase = user.pendingPurchases.find(p => p.id === purchaseId);
      if (!purchase) return res.status(404).json({ success:false, message:"Pesanan terkait form tidak ditemukan." });
      purchase.formResponses = purchase.formResponses && typeof purchase.formResponses === "object" ? purchase.formResponses : {};
      purchase.formResponses[messageId] = {
        submittedAt: new Date().toISOString(),
        responses: Object.fromEntries(fields.map(field => [field.key, String(responses[field.key] || "").trim()]))
      };
      message.responded = true;
      message.read = true;
      message.formSubmittedAt = new Date().toISOString();
    } else {
      return res.status(400).json({ success:false, message:"Action inbox tidak dikenal." });
    }

    await writeDatabase(database, sha, `Inbox ${action} ${user.username}`);
    return res.status(200).json({ success:true, message:"Inbox diperbarui.", user:safeUser(user), inbox:user.inbox });
  } catch (error) {
    console.error("Inbox error:", error);
    return res.status(500).json({ success:false, message:"Gagal memproses inbox." });
  }
}
