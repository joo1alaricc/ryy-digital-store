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
    const userToken = createUserToken(String(user.id));
    // Validate the freshly created token before sending it to the browser.
    // This prevents a broken APP_SECRET/runtime configuration from producing
    // a token that immediately fails /me with HTTP 401.
    const { verifyUserToken } = await import("../_auth.js");
    const verified = verifyUserToken(userToken);
    if (!verified || String(verified.userId) !== String(user.id)) {
      return res.status(503).json({success:false,message:"Sesi impersonation gagal diverifikasi oleh server."});
    }
    return res.status(200).json({success:true,user:safeUser(user),token:userToken,expiresIn:7*24*60*60*1000,impersonation:true});
  }catch(e){return res.status(500).json({success:false,message:e?.message||"Gagal membuka sesi user."});}
}
