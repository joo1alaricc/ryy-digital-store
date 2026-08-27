import crypto from 'node:crypto';
import { readKVJson, writeKVJson } from '../_github.js';
import { verifyUserToken } from '../_auth.js';
import { verifyAdminToken, isMainAdmin } from '../_admin.js';
const KEY='ryy:vouchers:v1';
const read=async()=> (await readKVJson(KEY)) || {vouchers:[]};
const write=async x=>writeKVJson(KEY,x);
function code(){return `RYY-STORE-${crypto.randomInt(1000000,9999999)}`;}
function admin(req){return verifyAdminToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''));}
function user(req){return verifyUserToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''));}
export default async function handler(req,res){
  try{
    const a=admin(req);
    if(a){if(!isMainAdmin(a))return res.status(403).json({success:false,message:'Hanya admin_utama yang dapat mengelola voucher.'}); const db=await read(); if(req.method==='GET')return res.status(200).json({success:true,vouchers:db.vouchers}); if(req.method!=='POST')return res.status(405).json({success:false,message:'Method tidak diizinkan.'}); const body=req.body||{}; const type=body.type==='cashback'?'cashback':'discount'; const mode=body.mode==='fixed'?'fixed':'percent'; const value=Math.max(0,Number(body.value)||0); if(!value)return res.status(400).json({success:false,message:'Nilai voucher wajib diisi.'}); const v={id:`voucher_${crypto.randomUUID()}`,code:code(),type,mode,value,maxUses:Math.max(0,Math.floor(Number(body.maxUses)||1)),uses:0,assignedUserId:String(body.assignedUserId||'').trim(),expiresAt:body.expiresAt||'',createdAt:new Date().toISOString(),active:true}; db.vouchers.unshift(v);await write(db);return res.status(201).json({success:true,message:'Voucher berhasil dibuat.',voucher:v,vouchers:db.vouchers}); }
    const s=user(req); if(!s)return res.status(401).json({success:false,message:'Sesi user tidak valid.'}); const db=await read(); const active=db.vouchers.filter(v=>v.active!==false&&(!v.expiresAt||new Date(v.expiresAt)>new Date())&&(!v.assignedUserId||v.assignedUserId===s.userId)&&Number(v.uses||0)<Number(v.maxUses||1)); if(req.method==='GET')return res.status(200).json({success:true,vouchers:active.map(v=>({code:v.code,type:v.type,mode:v.mode,value:v.value,expiresAt:v.expiresAt}))}); if(req.method==='POST'){const c=String(req.body?.code||'').trim().toUpperCase();const v=active.find(x=>x.code.toUpperCase()===c);if(!v)return res.status(404).json({success:false,message:'Voucher tidak tersedia atau sudah kedaluwarsa.'});return res.status(200).json({success:true,voucher:v});} return res.status(405).json({success:false,message:'Method tidak diizinkan.'});
  }catch(e){console.error('Voucher error',e);return res.status(500).json({success:false,message:e?.message||'Gagal memproses voucher.'});}
}
export { read as readVouchers, write as writeVouchers };
