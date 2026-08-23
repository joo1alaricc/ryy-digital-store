import { readDatabase } from "../_github.js";
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({success:false,message:"Method tidak diizinkan."});
  try{const {database}=await readDatabase();const users=(database.users||[]).map(u=>({username:u.username||"user",pendingPurchases:(u.pendingPurchases||[]).filter(p=>p.status==="confirmed"&&p.proofUrl).map(p=>({proofUrl:p.proofUrl,createdAt:p.processedAt||p.createdAt,items:p.items||[]}))})).filter(u=>u.pendingPurchases.length);return res.status(200).json({success:true,users});}
  catch(e){return res.status(500).json({success:false,message:e.message||"Gagal memuat testimoni."});}
}
