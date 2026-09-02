import { readDatabase, writeDatabase } from '../_github.js';
import {
  getConnectedMainGateway,
  extractWhatsAppMessageText,
  extractWhatsAppMessageSender
} from '../_whatsapp.js';
import { createRegistrationTicket } from '../_registration.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success:false, message:'Method tidak diizinkan.' });
  try {
    const id = String(req.body?.registrationId || '');
    if (!id) return res.status(400).json({ success:false, message:'Sesi registrasi tidak valid.' });

    const { database, sha } = await readDatabase();
    database.pendingRegistrations ||= [];
    const row = database.pendingRegistrations.find(x => x.id === id);
    if (!row) return res.status(404).json({ success:false, message:'Sesi registrasi tidak ditemukan.' });
    if (new Date(row.expiresAt || 0) < new Date()) return res.status(410).json({ success:false, message:'Sesi verifikasi sudah kedaluwarsa. Silakan mulai lagi.' });

    if (row.verified) {
      return res.status(200).json({
        success:true, verified:true,
        verificationToken:createRegistrationTicket({ registrationId:id, email:row.email, method:'whatsapp' })
      });
    }

    const connection = await getConnectedMainGateway();
    if (!connection.gateway) return res.status(503).json({ success:false, message:'Gateway WhatsApp admin_utama belum dikonfigurasi.' });
    if (!connection.connected) return res.status(503).json({ success:false, message:'Gateway WhatsApp admin_utama sedang tidak terhubung. Hubungkan bot terlebih dahulu.' });

    const messages = Array.isArray(connection.status?.messages) ? connection.status.messages : [];
    const hit = messages.find(m => {
      const sender = extractWhatsAppMessageSender(m);
      return Boolean(sender) && extractWhatsAppMessageText(m).includes(row.sn);
    });

    if (!hit) {
      return res.status(200).json({ success:true, verified:false, message:'Menunggu pesan WhatsApp dari kamu...' });
    }

    const senderPhone = extractWhatsAppMessageSender(hit);
    row.verified = true;
    row.verifiedAt = new Date().toISOString();
    row.senderPhone = senderPhone;
    await writeDatabase(database, sha, `Verify WhatsApp registration ${id}`);

    return res.status(200).json({
      success:true,
      verified:true,
      message:'Verifikasi WhatsApp berhasil. Lanjut buat username & password.',
      verificationToken:createRegistrationTicket({ registrationId:id, email:row.email, method:'whatsapp' })
    });
  } catch (e) {
    console.error('Verify WhatsApp registration error:', e);
    return res.status(500).json({ success:false, message:e?.message || 'Gagal memeriksa verifikasi WhatsApp.' });
  }
}
