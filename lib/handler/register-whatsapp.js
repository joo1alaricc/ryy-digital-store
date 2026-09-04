import { requireSecurity } from "../_security.js";
import { env } from "../_env.js";
import crypto from 'node:crypto';
import { readDatabase, writeDatabase } from '../_github.js';
import { getConnectedMainGateway, extractGatewayPhone } from '../_whatsapp.js';
import { randomSn } from '../_finance.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success:false, message:'Method tidak diizinkan.' });
  const securityError = await requireSecurity(req, res);
  if (securityError) return securityError;
  try {
    const { email } = req.body || {};

    const e = String(email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return res.status(400).json({ success:false, message:'Email tidak valid.' });

    const connection = await getConnectedMainGateway();
    const gateway = connection.gateway;
    if (!gateway) return res.status(503).json({ success:false, message:'Gateway WhatsApp admin_utama belum dikonfigurasi.' });
    if (!connection.connected) return res.status(503).json({ success:false, message:'Gateway WhatsApp admin_utama sedang tidak terhubung. Verifikasi via WhatsApp hanya tersedia saat gateway berstatus Connected.' });

    const phone = extractGatewayPhone(connection.status);
    if (!phone) return res.status(503).json({ success:false, message:'Nomor WhatsApp bot admin_utama belum dikonfigurasi.' });

    const { database, sha } = await readDatabase();
    database.pendingRegistrations ||= [];
    database.pendingRegistrations = database.pendingRegistrations.filter(x => new Date(x.expiresAt || 0) > new Date());

    const sn = randomSn('REGISTRY');
    const id = `reg_${crypto.randomUUID()}`;
    const row = {
      id, sn, email:e, method:'whatsapp',
      createdAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+15*60*1000).toISOString(),
      verified:false,
      senderPhone:''
    };
    database.pendingRegistrations.push(row);
    await writeDatabase(database, sha, `Create WhatsApp registration ${id}`);

    const message = `${sn}\n\nSaya ingin mendaftarkan akun ke RYY-STORE dengan Email: ${e}\n\n_*Jangan ubah pesan ini!*_`;
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    return res.status(200).json({
      success:true, registrationId:id, sn, message,
      waNumber:phone, waUrl, expiresAt:row.expiresAt,
      gatewayConnected:true, gatewayAdmin:'admin_utama'
    });
  } catch (e) {
    console.error('Register WhatsApp error:', e);
    return res.status(500).json({ success:false, message:e?.message || 'Gagal membuat verifikasi WhatsApp.' });
  }
}
