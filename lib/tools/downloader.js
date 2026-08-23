import { registerOtherTool } from "./registry.js";

// Self-register this feature in the Admin/User Other Tools registry.
registerOtherTool({
  id: "video-downloader",
  name: "Downloader video all platform",
  description: "Download video/audio dari berbagai platform.",
  defaultEnabled: true
});

const API = "https://api.nexray.eu.cc/downloader/aio";
function cleanUrl(value){ try { const u=new URL(String(value||"")); if(!/^https?:$/.test(u.protocol)) return null; return u.toString(); } catch { return null; } }
export default async function handler(req,res){
  if(req.method!=="GET") return res.status(405).json({success:false,message:"Method tidak diizinkan."});
  const target=cleanUrl(req.query?.url);
  if(!target) return res.status(400).json({success:false,message:"Link video tidak valid."});
  try{
    const upstream=await fetch(`${API}?url=${encodeURIComponent(target)}`,{headers:{Accept:"application/json","User-Agent":"RYY-Store-Downloader/1.0"}});
    const data=await upstream.json().catch(()=>null);
    if(!upstream.ok || !data?.status) return res.status(upstream.status||502).json({success:false,message:data?.message||"Video tidak dapat diproses."});
    const medias=Array.isArray(data.result?.medias)?data.result.medias:[];
    return res.status(200).json({success:true,author:data.author||"",result:{...data.result,medias:medias.map(m=>({url:m.url||"",quality:m.quality||"",type:m.type||"",extension:m.extension||"",width:m.width||0,height:m.height||0,data_size:m.data_size||0,duration:m.duration||0}))},timestamp:data.timestamp||new Date().toISOString(),response_time:data.response_time||null});
  }catch(e){ console.error("Downloader API error",e); return res.status(502).json({success:false,message:"Gagal menghubungi downloader API."}); }
}
