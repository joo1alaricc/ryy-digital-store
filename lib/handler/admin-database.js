import { verifyAdminToken, isMainAdmin } from "../_admin.js";
import { readDatabase, readKVJson, writeKVJson } from "../_github.js";
import { env, binding } from "../_env.js";

const ENV_OVERRIDES_KEY = "ryy:env-overrides:v1";
const ENV_KEYS = [
  "APP_SECRET","STORE_KV","ASSETS","ADMIN_USERNAME","ADMIN_EMAIL","ADMIN_PASSWORD","ADMIN_TOKEN_DEVELOPER","ADMIN_PIN","ADMIN_ROLE","ADMIN_USERS","ADMIN_SUPER_USERS",
  "BOT_BRIDGE_URL","BOT_BRIDGE_SECRET","BOT_ID","BOT_NAME","BOT_PROFILE_NAME","BOT_OWNER_PHONE","BOT_GATEWAYS",
  "GITHUB_TOKEN","GITHUB_OWNER","GITHUB_REPO","GITHUB_BRANCH","GITHUB_PATH",
  "GMAIL_USER","GMAIL_CLIENT_ID","GMAIL_CLIENT_SECRET","GMAIL_REFRESH_TOKEN","GOOGLE_CLIENT_ID",
  "GEMINI_API_KEY","GEMINI_MODEL",
  "BTZPAY_API_KEY","BTZPAY_BASE_URL","BTZPAY_CALLBACK_URL","BTZPAY_RETURN_URL","CRON_SECRET"
];

function auth(req){
  return verifyAdminToken(String(req.headers?.authorization||"").replace(/^Bearer\s+/i,""));
}
function store(){
  const s = binding("STORE_KV");
  return s && typeof s.get === "function" && typeof s.put === "function" ? s : null;
}
function normalizeValue(v){
  if(v===undefined || v===null) return "";
  return typeof v === "string" ? v : String(v);
}
async function overrides(){
  const s=store();
  if(!s) return {};
  const d=await s.get(ENV_OVERRIDES_KEY,"json");
  return d && typeof d === "object" ? d : {};
}

export default async function handler(req,res){
  const admin=auth(req);
  if(!admin) return res.status(401).json({success:false,message:"Sesi admin tidak valid."});
  if(!isMainAdmin(admin)) return res.status(403).json({success:false,message:"Tab Database hanya tersedia untuk admin_utama."});
  try{
    const action=String(req.body?.action||req.query?.action||"summary");
    if(action==="summary"){
      const {database}=await readDatabase();
      const ov=await overrides();
      const envData=Object.fromEntries(ENV_KEYS.map(key=>[key,{value:env(key,""),override:Object.prototype.hasOwnProperty.call(ov,key)}]));
      return res.status(200).json({success:true,products:database?.products||[],users:database?.users||[],env:envData,envOverrides:ov});
    }
    if(action==="env-save"){
      const key=String(req.body?.key||"").trim();
      if(!ENV_KEYS.includes(key)) return res.status(400).json({success:false,message:"Nama environment variable tidak diizinkan."});
      const value=normalizeValue(req.body?.value);
      const ov=await overrides();
      if(value==="" && req.body?.clear===true) delete ov[key];
      else ov[key]=value;
      const s=store();
      if(!s) return res.status(503).json({success:false,message:"STORE_KV binding tidak tersedia."});
      await s.put(ENV_OVERRIDES_KEY,JSON.stringify(ov));
      return res.status(200).json({success:true,message:req.body?.clear===true?`${key} dikembalikan ke environment runtime environment.`:`${key} berhasil disimpan sebagai override aplikasi.`,value: req.body?.clear===true ? env(key,"") : value,override:req.body?.clear!==true});
    }
    if(action==="env-reset-all"){
      const s=store();
      if(!s) return res.status(503).json({success:false,message:"STORE_KV binding tidak tersedia."});
      await s.put(ENV_OVERRIDES_KEY,JSON.stringify({}));
      return res.status(200).json({success:true,message:"Semua override ENV dihapus. Aplikasi kembali memakai environment runtime environment."});
    }
    if(action==="export"){
      const {database}=await readDatabase();
      const type=String(req.body?.type||"").toLowerCase();
      const format=String(req.body?.format||"json").toLowerCase();
      let payload;
      if(type==="products") payload=database?.products||[];
      else if(type==="users") payload=database?.users||[];
      else if(type==="env") payload=Object.fromEntries(ENV_KEYS.map(k=>[k,env(k,"")]));
      else return res.status(400).json({success:false,message:"Jenis data tidak dikenal."});
      const text=format==="txt" ? (type==="env" ? Object.entries(payload).map(([k,v])=>`${k}=${normalizeValue(v)}`).join("\n") : JSON.stringify(payload,null,2)) : JSON.stringify(payload,null,2);
      return res.status(200).json({success:true,type,format,filename:`ryy-store-${type}.${format==="txt"?"txt":"json"}`,content:text});
    }
    return res.status(400).json({success:false,message:"Action Database tidak dikenal."});
  }catch(e){
    console.error("Admin database error:",e);
    return res.status(500).json({success:false,message:e?.message||"Gagal memproses Database."});
  }
}
