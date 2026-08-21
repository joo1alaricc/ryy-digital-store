import { readDatabase, writeDatabase } from "../_github.js";
import { verifyAdminToken } from "../_admin.js";
function auth(req){const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");return verifyAdminToken(token);}
export default async function handler(req,res){
 const admin=auth(req);if(!admin)return res.status(401).json({success:false,message:'Sesi admin tidak valid.'});
 try{const {database,sha}=await readDatabase();database.users||=[];
  if(req.method==='GET'){const requests=[];for(const u of database.users){for(const r of (u.supportRequests||[]))requests.push({...r,userId:u.id,username:u.username,userEmail:u.email||''});}requests.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));return res.status(200).json({success:true,requests});}
  if(req.method==='PATCH'){const {userId,requestId,status}=req.body||{};const u=database.users.find(x=>x.id===userId);const r=u?.supportRequests?.find(x=>x.id===requestId);if(!u||!r)return res.status(404).json({success:false,message:'Permintaan tidak ditemukan.'});if(!['pending','approved','rejected','completed'].includes(status))return res.status(400).json({success:false,message:'Status tidak valid.'});r.status=status;r.updatedAt=new Date().toISOString();u.inbox||=[];u.inbox.unshift({id:`msg_${Date.now()}`,type:status==='approved'?'success':status==='rejected'?'info':'info',read:false,createdAt:new Date().toISOString(),title:'Update permintaan support',body:`Status permintaan ${r.type==='warranty'?'garansi':'refund'} Anda: ${status}.`});await writeDatabase(database,sha,`Admin support ${requestId}`);return res.status(200).json({success:true,request:r});}
  return res.status(405).json({success:false,message:'Method tidak diizinkan.'});
 }catch(e){console.error('Admin support error:',e);return res.status(500).json({success:false,message:'Gagal memproses support.'});}
}
