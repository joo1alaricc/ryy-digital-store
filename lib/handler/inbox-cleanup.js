import { env } from "../_env.js";
import { readDatabase, writeDatabase } from "../_github.js";

const MAX_AGE_MS = 60 * 60 * 1000;
function authorized(req){
  const expected=String(env("CRON_SECRET")||"").trim();
  if(!expected) return false;
  const got=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"").trim();
  return got===expected;
}
export default async function handler(req,res){
  if(req.method!=="GET"&&req.method!=="POST") return res.status(405).json({success:false,message:"Method tidak diizinkan."});
  if(!authorized(req)) return res.status(401).json({success:false,message:"Cron secret tidak valid."});
  try{
    const {database,sha}=await readDatabase(); const cutoff=Date.now()-MAX_AGE_MS; let removed=0;
    for(const user of database.users||[]){
      const before=Array.isArray(user.inbox)?user.inbox.length:0;
      user.inbox=(Array.isArray(user.inbox)?user.inbox:[]).filter(m=>{const t=new Date(m.createdAt||0).getTime(); return !Number.isFinite(t)||t>=cutoff;});
      removed+=before-user.inbox.length;
    }
    if(removed) await writeDatabase(database,sha,`Cleanup inbox older than 1 hour (${removed})`);
    return res.status(200).json({success:true,removed});
  }catch(error){console.error("Inbox cleanup error:",error);return res.status(500).json({success:false,message:"Gagal membersihkan inbox."});}
}
