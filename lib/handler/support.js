import crypto from "node:crypto";
import { readDatabase, writeDatabase } from "../_github.js";
import { verifyUserToken } from "../_auth.js";
import { safeUser } from "../_store.js";

const DAY_MS=24*60*60*1000;
function auth(req){const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");return verifyUserToken(token);}
function serviceFee(daysUsed){const d=Math.max(0,Number(daysUsed)||0);if(d>=30)return .3;if(d>=21)return .4;if(d>=7)return .5;return .6;}
function ensure(user){user.supportRequests=Array.isArray(user.supportRequests)?user.supportRequests:[];user.subscriptions=Array.isArray(user.subscriptions)?user.subscriptions:[];user.pendingPurchases=Array.isArray(user.pendingPurchases)?user.pendingPurchases:[];}
function calcRefund(purchase,sub,asOf=new Date()){
  const totalDays=Math.max(0,Number(sub?.durationDays||0));
  const start=new Date(sub?.purchasedAt||purchase?.createdAt||0); const now=asOf instanceof Date?asOf:new Date(asOf);
  const usedDays=Number.isFinite(start.getTime())?Math.max(0,(now-start)/DAY_MS):0;
  const remainingDays=Math.max(0,totalDays-usedDays); const fee=serviceFee(usedDays);
  const price=Number((purchase?.items||[]).find(i=>String(i.productName)===String(sub?.productName)&&String(i.typeName)===String(sub?.typeName))?.priceFinal||purchase?.totalSpent||0);
  const refund=price*(remainingDays/Math.max(totalDays,1))*fee;
  return {price,totalDays,usedDays,remainingDays,serviceFee:fee,refund};
}
export default async function handler(req,res){
  const session=auth(req); if(!session)return res.status(401).json({success:false,message:"Sesi user tidak valid."});
  try{
    const {database,sha}=await readDatabase(); database.users||=[]; const user=database.users.find(u=>u.id===session.userId); if(!user)return res.status(404).json({success:false,message:"User tidak ditemukan."}); ensure(user);
    if(req.method==='GET') return res.status(200).json({success:true,requests:user.supportRequests,user:safeUser(user)});
    if(req.method!=='POST')return res.status(405).json({success:false,message:"Method tidak diizinkan."});
    const type=String(req.body?.type||""); if(!['warranty','refund'].includes(type))return res.status(400).json({success:false,message:"Jenis permintaan tidak valid."});
    const request={id:`support_${crypto.randomUUID()}`,type,status:'pending',createdAt:new Date().toISOString()};
    if(type==='warranty'){
      const required=['emailUsed','productName','duration','purchaseDate','errorDate','reason','firstLoginScreenshot','errorScreenshot'];
      for(const k of required) if(!String(req.body?.[k]||'').trim())return res.status(400).json({success:false,message:`${k} wajib diisi.`});
      Object.assign(request,{emailUsed:String(req.body.emailUsed).trim(),productName:String(req.body.productName).trim(),duration:String(req.body.duration).trim(),purchaseDate:String(req.body.purchaseDate).trim(),errorDate:String(req.body.errorDate).trim(),reason:String(req.body.reason).trim(),firstLoginScreenshot:String(req.body.firstLoginScreenshot).trim(),errorScreenshot:String(req.body.errorScreenshot).trim()});
    }else{
      const purchaseId=String(req.body?.purchaseId||''); const subId=String(req.body?.subscriptionId||''); const purchase=user.pendingPurchases.find(p=>p.id===purchaseId); const sub=user.subscriptions.find(s=>String(s.id)===subId); if(!purchase||!sub)return res.status(404).json({success:false,message:'Data pembelian atau langganan tidak ditemukan.'});
      const calc=calcRefund(purchase,sub); Object.assign(request,{purchaseId,subscriptionId:subId,productName:sub.productName,typeName:sub.typeName,calculation:calc});
    }
    user.supportRequests.unshift(request); user.inbox||=[]; user.inbox.unshift({id:`msg_${crypto.randomUUID()}`,type:'info',read:false,createdAt:new Date().toISOString(),title:type==='warranty'?'Pengajuan garansi diterima':'Pengajuan refund diterima',body:'Permintaan Anda sudah diterima admin dan sedang diproses.'});
    await writeDatabase(database,sha,`${type} request ${user.username}`); return res.status(200).json({success:true,message:'Permintaan berhasil dikirim ke admin.',request,user:safeUser(user)});
  }catch(error){console.error('Support error:',error);return res.status(500).json({success:false,message:'Gagal mengirim permintaan support.'});}
}
export { calcRefund, serviceFee };
