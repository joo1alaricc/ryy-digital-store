import crypto from 'node:crypto';
import { readDatabase, writeDatabase } from '../_github.js';
import { verifyUserToken } from '../_auth.js';
import { safeUser } from '../_store.js';
import { env } from '../_env.js';
import { COIN_IDR, ensureWallet, creditCoins, addWalletTransaction, safeWallet } from '../_finance.js';

function auth(req){ return verifyUserToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')); }
function int(v){ return Math.max(0,Math.floor(Number(v)||0)); }
function makeOrderId(){ return `RYYDEP-${Date.now()}-${crypto.randomInt(100000,999999)}`; }

async function pakasirCreate(amount, orderId){
  const project=env('PAKASIR_PROJECT','').trim(); const apiKey=env('PAKASIR_API_KEY','').trim();
  if(!project||!apiKey) throw new Error('PAKASIR_PROJECT dan PAKASIR_API_KEY belum dikonfigurasi.');
  const r=await fetch('https://app.pakasir.com/api/transactioncreate/qris',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({project,order_id:orderId,amount,api_key:apiKey})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d?.payment) throw new Error(d?.message||`Pakasir gagal membuat transaksi (HTTP ${r.status}).`);
  return d.payment;
}

export default async function handler(req,res){
  const session=auth(req); if(!session)return res.status(401).json({success:false,message:'Sesi user tidak valid.'});
  try{
    const {database,sha}=await readDatabase(); const user=(database.users||[]).find(u=>u.id===session.userId);
    if(!user)return res.status(404).json({success:false,message:'User tidak ditemukan.'});
    const w=ensureWallet(user);
    if(req.method==='GET')return res.status(200).json({success:true,wallet:safeWallet(user),user:safeUser(user)});
    if(req.method!=='POST')return res.status(405).json({success:false,message:'Method tidak diizinkan.'});
    const action=String(req.body?.action||'');
    if(action==='createDeposit'){
      const amount=int(req.body?.amount); if(amount<1000)return res.status(400).json({success:false,message:'Minimal deposit Rp1.000.'});
      if(amount>10000000)return res.status(400).json({success:false,message:'Maksimal deposit Rp10.000.000 per transaksi.'});
      const orderId=makeOrderId(); const payment=await pakasirCreate(amount,orderId);
      const deposit={orderId,amount,coins:Math.floor(amount/COIN_IDR),fee:int(payment.fee),totalPayment:int(payment.total_payment||amount),paymentNumber:String(payment.payment_number||''),expiredAt:payment.expired_at||'',status:'pending',createdAt:new Date().toISOString()};
      w.deposits.unshift(deposit); w.deposits=w.deposits.slice(0,30);
      addWalletTransaction(user,{type:'deposit_pending',idr:amount,coins:deposit.coins,reason:'Deposit QRIS',orderId});
      await writeDatabase(database,sha,`Create deposit ${orderId}`);
      return res.status(200).json({success:true,message:'QRIS deposit berhasil dibuat.',deposit,wallet:safeWallet(user),user:safeUser(user)});
    }
    if(action==='claimDaily'||action==='gacha'){
      const key=action==='claimDaily'?'dailyClaimAt':'gachaAt'; const last=w[key]?new Date(w[key]).getTime():0;
      if(last && Date.now()-last<24*60*60*1000){ const remain=24*60*60*1000-(Date.now()-last); return res.status(429).json({success:false,message:`${action==='claimDaily'?'Claim harian':'Gacha'} bisa digunakan lagi dalam ${Math.ceil(remain/3600000)} jam.`}); }
      const coins=crypto.randomInt(1,26); w[key]=new Date().toISOString(); creditCoins(user,coins,action==='claimDaily'?'Claim harian':'Gacha Spinner'); await writeDatabase(database,sha,`${action} coins for ${user.username}`); return res.status(200).json({success:true,coins,wallet:safeWallet(user),user:safeUser(user)});
    }
    if(action==='claimCashback'){
      const id=String(req.body?.cashbackId||''); const item=w.cashbackPending.find(x=>String(x.id)===id);
      if(!item)return res.status(404).json({success:false,message:'Cashback tidak ditemukan.'});
      const amount=int(item.amountIdr); item.status='claimed'; item.claimedAt=new Date().toISOString(); w.cashbackPending=w.cashbackPending.filter(x=>x.id!==item.id); w.claimedCashback.unshift({...item}); w.totalCashbackIdr+=amount; creditCoins(user,Math.floor(amount/COIN_IDR),'Cashback voucher',{cashbackId:item.id}); await writeDatabase(database,sha,`Claim cashback ${item.id}`); return res.status(200).json({success:true,message:`Cashback ${amount.toLocaleString('id-ID')} rupiah dikonversi menjadi ${Math.floor(amount/COIN_IDR)} koin.`,wallet:safeWallet(user),user:safeUser(user)});
    }
    return res.status(400).json({success:false,message:'Action wallet tidak dikenal.'});
  }catch(e){console.error('Wallet error',e);return res.status(500).json({success:false,message:e?.message||'Gagal memproses saldo.'});}
}
