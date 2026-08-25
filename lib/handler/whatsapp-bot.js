import { verifyAdminToken, isMainAdmin } from "../_admin.js";
import {
  getGateways,
  getGatewayByAdmin,
  getMainGateway,
  upsertGateway,
  removeGateway,
  gatewayFetch,
  sendGatewayText,
  sendGatewayImage,
  cleanPhone
} from "../_whatsapp.js";

function admin(req) {
  const token = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyAdminToken(token);
}

function safeGateway(g) {
  if (!g) return null;
  return {
    id:g.id,
    adminUsername:g.adminUsername,
    adminEmail:g.adminEmail,
    botName:g.botName,
    botId:g.botId,
    bridgeUrl:g.bridgeUrl,
    ownerPhone:g.ownerPhone,
    profileName:g.profileName,
    enabled:g.enabled !== false,
    secretConfigured:Boolean(g.secretConfigured)
  };
}

function findAllowedGateway(adminUser, gatewayId) {
  return getGateways().then(async gateways => {
    const own = await getGatewayByAdmin(adminUser);
    if (isMainAdmin(adminUser) && gatewayId) {
      const found = gateways.find(g => g.id === String(gatewayId));
      if (!found) throw new Error("Gateway tidak ditemukan.");
      return found;
    }
    if (!own) throw new Error("Gateway WhatsApp untuk admin ini belum dikonfigurasi.");
    return own;
  });
}

async function diagnose(gateway) {
  const result = {
    success:false,
    gateway:safeGateway(gateway),
    bridgeUrl:gateway?.bridgeUrl || "",
    botIdSent:gateway?.botId || "",
    secretConfigured:Boolean(gateway?.secretConfigured),
    authorizationSent:true,
    botIdHeaderSent:true,
    health:null,
    authenticatedRequest:null
  };
  if (!gateway?.bridgeUrl) {
    result.message="Bridge URL belum dikonfigurasi.";
    return result;
  }
  try {
    const r=await fetch(`${gateway.bridgeUrl}/health`,{headers:{Accept:"application/json"}});
    const raw=await r.text().catch(()=> "");
    let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw:raw.slice(0,500)}}
    result.health={ok:r.ok,status:r.status,response:data};
  }catch(e){
    result.health={ok:false,status:0,error:e?.message||"network error"};
    result.message="Bridge URL tidak dapat diakses dari Cloudflare Worker.";
    return result;
  }
  try {
    await gatewayFetch(gateway,"/status",{method:"GET"});
    result.authenticatedRequest={ok:true,status:200,response:{success:true}};
    result.success=true;
    result.message="Autentikasi bridge berhasil.";
  }catch(e){
    result.authenticatedRequest={
      ok:false,
      status:e?.bridge?.status || 0,
      response:e?.bridge?.response || {},
      error:e?.message || "request gagal"
    };
    result.message=e?.message || "Bridge menolak request authenticated.";
  }
  return result;
}

export default async function handler(req,res) {
  const adminUser=admin(req);
  if(!adminUser) return res.status(401).json({success:false,message:"Sesi admin tidak valid."});

  try {
    const method=String(req.method||"GET").toUpperCase();
    const action=String(req.body?.action||req.query?.action||"status");

    if(action==="list") {
      if(!isMainAdmin(adminUser)) {
        const own=await getGatewayByAdmin(adminUser);
        return res.status(200).json({success:true,gateway:safeGateway(own),gateways:own?[safeGateway(own)]:[]});
      }
      const gateways=await getGateways();
      return res.status(200).json({success:true,gateways:gateways.map(safeGateway)});
    }

    if(action==="save") {
      const body=req.body||{};
      const targetId=String(body.id||"");
      if(!isMainAdmin(adminUser)) {
        const own=await getGatewayByAdmin(adminUser);
        if(targetId && own?.id!==targetId) return res.status(403).json({success:false,message:"Anda hanya dapat mengubah gateway milik sendiri."});
      }
      const existing=targetId ? (await getGateways()).find(g=>g.id===targetId) : await getGatewayByAdmin(adminUser);
      const secretProvided=Object.prototype.hasOwnProperty.call(body,"bridgeSecret") && String(body.bridgeSecret||"").trim()!=="";
      const gateway=await upsertGateway({
        id:targetId||existing?.id,
        adminUsername:isMainAdmin(adminUser) ? String(body.adminUsername||existing?.adminUsername||adminUser.username) : adminUser.username,
        adminEmail:isMainAdmin(adminUser) ? String(body.adminEmail||existing?.adminEmail||adminUser.email) : adminUser.email,
        botName:String(body.botName||existing?.botName||"RYY WhatsApp Gateway"),
        botId:String(body.botId||existing?.botId||""),
        bridgeUrl:String(body.bridgeUrl||existing?.bridgeUrl||""),
        ownerPhone:cleanPhone(body.ownerPhone||existing?.ownerPhone||""),
        profileName:String(body.profileName||existing?.profileName||""),
        enabled:body.enabled===undefined ? (existing?.enabled!==false) : Boolean(body.enabled),
        bridgeSecret:secretProvided ? String(body.bridgeSecret) : undefined,
        secretConfigured:secretProvided ? true : Boolean(existing?.secretConfigured)
      },{secretProvided});
      return res.status(200).json({success:true,gateway:safeGateway(gateway)});
    }

    if(action==="delete") {
      if(!isMainAdmin(adminUser)) return res.status(403).json({success:false,message:"Hanya admin utama yang dapat menghapus gateway."});
      const gateways=await removeGateway(req.body?.id);
      return res.status(200).json({success:true,gateways:gateways.map(safeGateway)});
    }

    const gateway=await findAllowedGateway(adminUser,req.body?.gatewayId||req.query?.gatewayId);
    if(action==="diagnose") return res.status(200).json(await diagnose(gateway));
    if(action==="health") {
      const r=await fetch(`${gateway.bridgeUrl}/health`,{headers:{Accept:"application/json"}});
      const data=await r.json().catch(()=>({}));
      return res.status(r.ok?200:502).json(data);
    }
    if(method==="GET" || action==="status") return res.status(200).json({success:true,...(await gatewayFetch(gateway,"/status",{method:"GET"})),gateway:safeGateway(gateway)});

    if(method!=="POST") return res.status(405).json({success:false,message:"Method tidak diizinkan."});

    if(action==="update-profile") {
      return res.status(200).json(await gatewayFetch(gateway,"/update-profile",{method:"POST",body:{profileName:String(req.body?.profileName||"").trim(),about:String(req.body?.about||"").trim()}}));
    }
    if(action==="qr") {
      return res.status(200).json({...await gatewayFetch(gateway,"/qr",{method:"POST",body:{}}),gateway:safeGateway(gateway)});
    }
    if(action==="pair") {
      const phone=cleanPhone(req.body?.phone);
      if(!phone) return res.status(400).json({success:false,message:"Nomor WhatsApp wajib diisi."});
      return res.status(200).json({...await gatewayFetch(gateway,"/pair",{method:"POST",body:{phone}}),gateway:safeGateway(gateway)});
    }
    if(action==="send") {
      return res.status(200).json(await sendGatewayText(gateway,req.body?.to,req.body?.text));
    }
    if(action==="send-image") {
      return res.status(200).json(await sendGatewayImage(gateway,req.body?.to,req.body?.imageUrl,req.body?.caption));
    }
    if(action==="disconnect") return res.status(200).json(await gatewayFetch(gateway,"/disconnect",{method:"POST",body:{}}));
    if(action==="restart") return res.status(200).json(await gatewayFetch(gateway,"/restart",{method:"POST",body:{}}));

    return res.status(400).json({success:false,message:"Action bot tidak dikenal."});
  }catch(error){
    console.error("WhatsApp bot bridge error:",error);
    return res.status(error?.bridge?.status===401?401:502).json({
      success:false,
      message:error?.message||"Bot WhatsApp tidak dapat dihubungi.",
      bridge:error?.bridge ? {
        status:error.bridge.status,
        response:error.bridge.response
      } : undefined
    });
  }
}
