import { readDatabase } from "../_github.js";
import { verifyAdminToken, isSuperAdmin } from "../_admin.js";
import { createUserToken } from "../_auth.js";
import { safeUser } from "../_store.js";

export default async function handler(req,res){
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const admin=verifyAdminToken(token);
  if(!admin)return res.status(401).json({success:false,message:"Sesi admin tidak valid."});
  if(!isSuperAdmin(admin))return res.status(403).json({success:false,message:"Fitur Log in as User hanya tersedia untuk Super Admin."});
  if(req.method!=="POST")return res.status(405).json({success:false,message:"Method tidak diizinkan."});
  try{
    const {database}=await readDatabase();
    const user=(database.users||[]).find(u=>u.id===String(req.body?.userId||""));
    if(!user)return res.status(404).json({success:false,message:"User tidak ditemukan."});
    return res.status(200).json({success:true,user:safeUser(user),token:createUserToken(user.id),expiresIn:7*24*60*60*1000});
  }catch(e){return res.status(500).json({success:false,message:e?.message||"Gagal membuka sesi user."});}
}
