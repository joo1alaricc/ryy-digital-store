import { readDatabase } from "../_github.js";
import { verifyUserToken } from "../_auth.js";
import { safeUser } from "../_store.js";

export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({success:false,message:"Method tidak diizinkan."});
  try{
    const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    const session=verifyUserToken(token);
    if(!session) return res.status(401).json({success:false,message:"Sesi user tidak valid atau sudah kedaluwarsa."});
    const {database}=await readDatabase();
    const user=(database.users||[]).find(u=>u.id===session.userId);
    if(!user) return res.status(404).json({success:false,message:"User tidak ditemukan."});
    return res.status(200).json({success:true,user:safeUser(user)});
  }catch(error){
    console.error("Me API error:",error);
    return res.status(500).json({success:false,message:"Gagal mengambil data user."});
  }
}
