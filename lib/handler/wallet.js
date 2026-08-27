import crypto from 'node:crypto';
import { readDatabase, writeDatabase } from '../_github.js';
import { verifyUserToken } from '../_auth.js';
import { safeUser } from '../_store.js';
import { env } from '../_env.js';
import { COIN_IDR, ensureWallet, creditCoins, addWalletTransaction, safeWallet } from '../_finance.js';

function auth(req){ return verifyUserToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')); }
function int(v){ return Math.max(0,Math.floor(Number(v)||0)); }
function makeOrderId(){ return `RYYDEP-${Date.now()}-${crypto.randomInt(100000,999999)}`; }

async function btzCreateQris(amount, orderId, user, req){
  const apiKey=env('BTZPAY_API_KEY','').trim();
  if(!apiKey) throw new Error('BTZPAY_API_KEY belum dikonfigurasi.');
  const base=env('BTZPAY_BASE_URL','https://web.btzpay.my.id').replace(/\/+$/,'');
  const origin=String(req.headers?.origin||'').trim() || (()=>{try{return new URL(req.url).origin}catch{return 'https://ryy-store.pages.dev'}})();
  const callbackUrl=env('BTZPAY_CALLBACK_URL','').trim() || `${origin}/api/deposit-webhook`;
  const returnUrl=env('BTZPAY_RETURN_URL','').trim() || `${origin}/#profile`;
  const payload={
    apikey:apiKey,
    amount,
    fee:0,
    timeout:900000,
    callback_url:callbackUrl,
    return_url:returnUrl,
    notes:`RYY STORE deposit ${orderId}`,
    metadata:{orderId,productName:'RYY STORE Deposit',userId:String(user.id||'')},
    customerInfo:{name:String(user.displayName||user.username||'User'),email:String(user.email||''),phone:String(user.phone||'')}
  };
  const r=await fetch(`${base}/api/qris/create`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d?.success||!d?.data?.transactionId){ const detail=d?.message||d?.error||d?.errors?.[0]?.message||`HTTP ${r.status}`; throw new Error(`BTZ Paygate: ${detail}`); }
  return d.data;
}


async function btzTransaction(transactionId, accessKey){
  const base=env('BTZPAY_BASE_URL','https://web.btzpay.my.id').replace(/\/+$/,'');
  if(!transactionId||!accessKey)return null;
  const url=`${base}/api/qris/transaction/${encodeURIComponent(transactionId)}?key=${encodeURIComponent(accessKey)}`;
  const r=await fetch(url,{headers:{Accept:'application/json'}});
  const d=await r.json().catch(()=>({}));
  return r.ok&&d?.success?d.data||null:null;
}

async function syncPendingDeposits(database,user){
  const w=ensureWallet(user); let changed=false;
  const now=Date.now();
  for(const dep of w.deposits.filter(d=>d.status==='pending'&&d.transactionId&&d.accessKey).slice(0,3)){
    const last=Date.parse(dep.lastSyncAt||'')||0;
    if(last && now-last<8000)continue;
    dep.lastSyncAt=new Date().toISOString(); changed=true;
    try{
      const tx=await btzTransaction(String(dep.transactionId),String(dep.accessKey));
      if(!tx)continue;
      const st=String(tx.status||'').toLowerCase();
      if(st==='sukses' && Math.floor(Number(tx.amount)||0)===Number(dep.amount)){
        dep.status='completed'; dep.completedAt=new Date().toISOString(); dep.verifiedTransaction=tx;
        w.totalDepositedIdr+=Number(dep.amount);
        creditCoins(user,Math.floor(Number(dep.amount)/COIN_IDR),'Deposit QRIS',{orderId:dep.orderId,transactionId:dep.transactionId});
      }else if(['expired','gagal','cancel'].includes(st)){
        dep.status=st; dep.updatedAt=new Date().toISOString();
      }
    }catch(e){ console.warn('BTZ deposit sync:',e?.message||e); }
  }
  return changed;
}


export default async function handler(req,res){
  const session=auth(req); if(!session)return res.status(401).json({success:false,message:'Sesi user tidak valid.'});
  try{
    const {database,sha}=await readDatabase(); const user=(database.users||[]).find(u=>u.id===session.userId);
    if(!user)return res.status(404).json({success:false,message:'User tidak ditemukan.'});
    let w=ensureWallet(user);
    if(req.method==='GET'){ const changed=await syncPendingDeposits(database,user); if(changed)await writeDatabase(database,sha,`Sync BTZ deposits for ${user.username}`); return res.status(200).json({success:true,wallet:safeWallet(user),user:safeUser(user)}); }
    if(req.method!=='POST')return res.status(405).json({success:false,message:'Method tidak diizinkan.'});
    const action=String(req.body?.action||'');
    if(action==='createDeposit'){
      const amount=int(req.body?.amount); if(amount<1000)return res.status(400).json({success:false,message:'Minimal deposit Rp1.000.'});
      if(amount>10000000)return res.status(400).json({success:false,message:'Maksimal deposit Rp10.000.000 per transaksi.'});
      const orderId=makeOrderId(); const payment=await btzCreateQris(amount,orderId,user,req);
      const deposit={orderId,amount,coins:Math.floor(amount/COIN_IDR),fee:int(payment.fee),totalPayment:int(payment.totalAmount||amount),paymentNumber:String(payment.qrisString||''),qrisString:String(payment.qrisString||''),qrisImage:String(payment.qrisImage||''),paymentUrl:String(payment.paymentUrl||''),transactionId:String(payment.transactionId||''),accessKey:String(payment.accessKey||''),paymentMethod:String(payment.paymentMethod||''),paymentType:String(payment.paymentType||''),expiredAt:payment.expiredAt||'',status:'pending',createdAt:new Date().toISOString()};
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
