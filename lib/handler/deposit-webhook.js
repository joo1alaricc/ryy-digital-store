import { readDatabase, writeDatabase } from '../_github.js';
import { env } from '../_env.js';
import { ensureWallet, creditCoins } from '../_finance.js';
import { safeUser } from '../_store.js';

async function verifyTransaction(orderId,amount){
  const project=env('PAKASIR_PROJECT','').trim(),apiKey=env('PAKASIR_API_KEY','').trim();
  if(!project||!apiKey)return null;
  const url=`https://app.pakasir.com/api/transactiondetail?project=${encodeURIComponent(project)}&amount=${encodeURIComponent(amount)}&order_id=${encodeURIComponent(orderId)}&api_key=${encodeURIComponent(apiKey)}`;
  const r=await fetch(url,{headers:{Accept:'application/json'}}); const d=await r.json().catch(()=>({})); return r.ok?d?.transaction||null:null;
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({success:false,message:'Method tidak diizinkan.'});
  try{
    const body=req.body||{}; const orderId=String(body.order_id||'').trim(); const amount=Math.floor(Number(body.amount)||0); const project=String(body.project||'').trim();
    if(!orderId||!amount||String(body.status||'').toLowerCase()!=='completed')return res.status(400).json({success:false,message:'Webhook belum lengkap.'});
    const expectedProject=env('PAKASIR_PROJECT','').trim(); if(expectedProject&&project!==expectedProject)return res.status(403).json({success:false,message:'Project webhook tidak cocok.'});
    const verified=await verifyTransaction(orderId,amount); if(!verified||String(verified.status).toLowerCase()!=='completed'||Number(verified.amount)!==amount)return res.status(400).json({success:false,message:'Transaksi tidak lolos verifikasi.'});
    const {database,sha}=await readDatabase(); const user=(database.users||[]).find(u=>ensureWallet(u).deposits.some(d=>d.orderId===orderId)); if(!user)return res.status(404).json({success:false,message:'Deposit tidak ditemukan.'});
    const w=ensureWallet(user); const dep=w.deposits.find(d=>d.orderId===orderId); if(dep.status==='completed')return res.status(200).json({success:true,message:'Deposit sudah diproses.'});
    if(Number(dep.amount)!==amount)return res.status(400).json({success:false,message:'Nominal deposit tidak cocok.'});
    dep.status='completed';dep.completedAt=new Date().toISOString();dep.webhook=body;w.totalDepositedIdr+=amount;creditCoins(user,Math.floor(amount/10),'Deposit QRIS',{orderId});await writeDatabase(database,sha,`Complete deposit ${orderId}`);
    return res.status(200).json({success:true,message:'Deposit berhasil dikonversi menjadi koin.',coins:Math.floor(amount/10),user:safeUser(user)});
  }catch(e){console.error('Deposit webhook error',e);return res.status(500).json({success:false,message:'Webhook deposit gagal.'});}
}
