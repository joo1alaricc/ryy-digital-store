import crypto from "node:crypto";
import { readDatabase, writeDatabase } from "../_github.js";
import { verifyUserToken } from "../_auth.js";
import { verifyAdminToken } from "../_admin.js";

function userSession(req){ const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,""); return verifyUserToken(token); }
function adminSession(req){ const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,""); return verifyAdminToken(token); }
function key(email){ return String(email||"").trim().toLowerCase(); }
function ensureStore(database){ database.chatting ||= {}; database.chatting.conversations ||= {}; return database.chatting; }
function cleanMessage(m){ return { id:m.id, sender:m.sender, senderName:m.senderName, text:m.text, createdAt:m.createdAt, readByUser:!!m.readByUser, readByAdmin:!!m.readByAdmin }; }

export default async function handler(req,res){
  try{
    if(!["GET","POST","PATCH"].includes(req.method)) return res.status(405).json({success:false,message:"Method tidak diizinkan."});
    const {database,sha}=await readDatabase();
    const store=ensureStore(database);

    if(req.method==="GET"){
      const admin=adminSession(req);
      if(admin){
        const conversations=Object.entries(store.conversations).map(([email,c])=>({email,username:c.username||email,messages:(c.messages||[]).map(cleanMessage),updatedAt:c.updatedAt||"",unreadByAdmin:(c.messages||[]).filter(m=>!m.readByAdmin&&m.sender==="user").length})).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
        return res.status(200).json({success:true,conversations});
      }
      const session=userSession(req); if(!session) return res.status(401).json({success:false,message:"Sesi user tidak valid."});
      const user=(database.users||[]).find(u=>u.id===session.userId); if(!user) return res.status(404).json({success:false,message:"User tidak ditemukan."});
      const k=key(user.email); const c=store.conversations[k]||{email:user.email,username:user.username,messages:[]};
      c.messages=(c.messages||[]).map(cleanMessage);
      let changed=false; c.messages.forEach(m=>{if(m.sender==="admin"&&!m.readByUser){m.readByUser=true;changed=true;}});
      store.conversations[k]=c;
      if(changed) await writeDatabase(database,sha,`Mark chat read ${user.username}`);
      return res.status(200).json({success:true,conversation:c});
    }

    if(req.method==="POST"){
      const admin=adminSession(req);
      if(admin){
        const email=key(req.body?.email); const text=String(req.body?.text||"").trim();
        if(!email||!text) return res.status(400).json({success:false,message:"Email dan pesan wajib diisi."});
        const user=(database.users||[]).find(u=>key(u.email)===email); if(!user) return res.status(404).json({success:false,message:"User tidak ditemukan."});
        const c=store.conversations[email]||{email:user.email,username:user.username,messages:[]}; c.email=user.email;c.username=user.username;c.messages ||= [];
        c.messages.forEach(m=>{if(m.sender==="user")m.readByAdmin=true;});
        c.messages.push({id:`chat_${crypto.randomUUID()}`,sender:"admin",senderName:"ADMIN RYY STORE",text,createdAt:new Date().toISOString(),readByUser:false,readByAdmin:true});
        c.updatedAt=new Date().toISOString();store.conversations[email]=c;
        await writeDatabase(database,sha,`Admin chat ${user.username}`);
        return res.status(200).json({success:true,conversation:c});
      }
      const session=userSession(req); if(!session) return res.status(401).json({success:false,message:"Sesi user tidak valid."});
      const user=(database.users||[]).find(u=>u.id===session.userId); if(!user) return res.status(404).json({success:false,message:"User tidak ditemukan."});
      const text=String(req.body?.text||"").trim(); if(!text) return res.status(400).json({success:false,message:"Pesan tidak boleh kosong."}); if(text.length>4000) return res.status(400).json({success:false,message:"Pesan terlalu panjang."});
      const k=key(user.email); const c=store.conversations[k]||{email:user.email,username:user.username,messages:[]}; c.email=user.email;c.username=user.username;c.messages ||= [];
      c.messages.push({id:`chat_${crypto.randomUUID()}`,sender:"user",senderName:user.username,text,createdAt:new Date().toISOString(),readByUser:true,readByAdmin:false});
      c.updatedAt=new Date().toISOString();store.conversations[k]=c;
      await writeDatabase(database,sha,`User chat ${user.username}`);
      return res.status(200).json({success:true,conversation:c});
    }

    return res.status(400).json({success:false,message:"Permintaan chat tidak valid."});
  }catch(error){ console.error("Chat error:",error); return res.status(500).json({success:false,message:error?.message||"Gagal memproses chat."}); }
}
