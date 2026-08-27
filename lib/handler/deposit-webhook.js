import { readDatabase, writeDatabase } from '../_github.js';
import { env } from '../_env.js';
import { ensureWallet, creditCoins } from '../_finance.js';
import { safeUser } from '../_store.js';

async function verifyBtzTransaction(transactionId, accessKey){
  const base=env('BTZPAY_BASE_URL','https://web.btzpay.my.id').replace(/\/+$/,'');
  if(!transactionId||!accessKey)return null;
  const url=`${base}/api/qris/transaction/${encodeURIComponent(transactionId)}?key=${encodeURIComponent(accessKey)}`;
  const r=await fetch(url,{headers:{Accept:'application/json'}});
  const d=await r.json().catch(()=>({}));
  return r.ok&&d?.success?d.data||null:null;
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({success:false,message:'Method tidak diizinkan.'});
  try{
    const body=req.body||{};
    const raw=body.raw?.data||body.data||{};
    const transactionId=String(body.pay_id||raw.transactionId||body.transactionId||'').trim();
    const status=String(body.status||raw.status||'').toLowerCase().trim();
    const amount=Math.floor(Number(raw.amount??body.amount)||0);
    if(!transactionId)return res.status(400).json({success:false,message:'transactionId callback tidak ditemukan.'});

    const {database,sha}=await readDatabase();
    let foundUser=null, dep=null;
    for(const u of (database.users||[])){
      const w=ensureWallet(u);
      const hit=w.deposits.find(d=>String(d.transactionId||'')===transactionId || String(d.orderId||'')===String(raw.orderId||''));
      if(hit){foundUser=u;dep=hit;break;}
    }
    if(!foundUser||!dep)return res.status(404).json({success:false,message:'Deposit tidak ditemukan.'});
    if(dep.status==='completed')return res.status(200).json({success:true,message:'Deposit sudah diproses.'});

    if(status!=='sukses'){
      if(['expired','gagal','cancel'].includes(status)){
        dep.status=status;dep.updatedAt=new Date().toISOString();dep.callback=body;
        await writeDatabase(database,sha,`BTZ deposit ${status} ${dep.orderId}`);
      }
      return res.status(200).json({success:true,message:`Status deposit: ${status||'ignored'}.`});
    }

    const verified=await verifyBtzTransaction(transactionId,String(dep.accessKey||''));
    if(!verified||String(verified.transactionId||'')!==transactionId||String(verified.status||'').toLowerCase()!=='sukses')return res.status(400).json({success:false,message:'Transaksi BTZ tidak lolos verifikasi.'});
    const paidAmount=Math.floor(Number(verified.amount)||0);
    if(paidAmount!==Number(dep.amount))return res.status(400).json({success:false,message:'Nominal transaksi BTZ tidak cocok dengan deposit.'});

    const w=ensureWallet(foundUser);
    if(dep.status==='completed')return res.status(200).json({success:true,message:'Deposit sudah diproses.'});
    dep.status='completed';dep.completedAt=new Date().toISOString();dep.callback=body;dep.verifiedTransaction=verified;
    w.totalDepositedIdr+=Number(dep.amount);
    creditCoins(foundUser,Math.floor(Number(dep.amount)/10),'Deposit QRIS',{orderId:dep.orderId,transactionId});
    await writeDatabase(database,sha,`Complete BTZ deposit ${dep.orderId}`);
    return res.status(200).json({success:true,message:'Deposit berhasil dikonfirmasi dan dikonversi menjadi koin.',coins:Math.floor(Number(dep.amount)/10),user:safeUser(foundUser)});
  }catch(e){console.error('BTZ deposit webhook error',e);return res.status(500).json({success:false,message:'Webhook deposit gagal.'});}
}
