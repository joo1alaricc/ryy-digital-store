import { readDatabase, writeDatabase, readRepoJson, readKVJson, writeKVJson, readJsonAsset } from "../_github.js";
import { verifyUserToken } from "../_auth.js";
import { normalizeProduct, normalizeCatalog, resellerPrice, safeUser, typeStock, optionSurcharge } from "../_store.js";
import crypto from "node:crypto";
import { isValidUploadedImageUrl } from "../_image-upload.js";
import { notifyAllGatewaysNewOrder } from "../_whatsapp.js";
import { verifyTurnstile } from "../_turnstile.js";
import { ensureWallet, debitCoins, starterOfferEligible, markStarterOfferUsed } from "../_finance.js";
import { readVouchers, writeVouchers } from "./voucher.js";

const PRODUCTS_KV_KEY = "ryy:products:v1";

async function readProductsCatalog() {
    let data = await readKVJson(PRODUCTS_KV_KEY);
    if (!data) {
        try {
            data = (await readRepoJson("produk.json")).data;
        } catch (error) {
            console.warn("Checkout: GitHub produk.json tidak tersedia, fallback ke asset/KV:", error?.message || error);
            data = await readJsonAsset("produk.json");
        }
        if (data) {
            try { await writeKVJson(PRODUCTS_KV_KEY, data); } catch (error) {
                console.warn("Checkout: gagal meng-cache produk ke KV:", error?.message || error);
            }
        }
    }
    return data;
}

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });

    try {
        const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        const session = verifyUserToken(token);
        const turnstile = await verifyTurnstile(req.body?.turnstileToken, req);
        if (!turnstile.success) return res.status(403).json({ success:false, message:turnstile.message || "Verifikasi Cloudflare Turnstile gagal.", code:"TURNSTILE_REQUIRED", errors:turnstile.errors || [] });
        if (!session) return res.status(401).json({ success:false, message:"Sesi user tidak valid atau sudah kedaluwarsa." });

        const { database, sha } = await readDatabase();
        database.users ||= [];
        const user = database.users.find(u => u.id === session.userId);
        if (!user) return res.status(404).json({ success:false, message:"User tidak ditemukan." });

        user.reseller = user.reseller === true;
        user.pendingPurchases = Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [];
        user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
        user.inbox = Array.isArray(user.inbox) ? user.inbox : [];

        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const targetPhone = String(req.body?.targetPhone || "").trim();
        const paymentMethod = String(req.body?.paymentMethod || "").trim();
        const proofUrl = String(req.body?.proofUrl || "").trim();
        const voucherCode = String(req.body?.voucherCode || "").trim().toUpperCase();
        const coinPayment = paymentMethod === "RYY_COIN";
        if (!items.length || !targetPhone || !paymentMethod || (!coinPayment && !proofUrl)) {
            return res.status(400).json({ success:false, message:coinPayment ? "Produk, nomor penerima, dan metode pembayaran wajib diisi." : "Produk, nomor penerima, metode pembayaran, dan bukti pembayaran wajib diisi." });
        }
        if (proofUrl && !isValidUploadedImageUrl(proofUrl)) return res.status(400).json({ success:false, message:"URL bukti pembayaran tidak valid." });
        const wallet = ensureWallet(user);

        const allowedParameters = new Set(["email","emailPassword","mlId","ffId","meterNumber","phone","ewalletNumber"]);
        const normalizeOptions = value => Array.isArray(value) ? [...new Set(value.map(v=>String(v||"").trim()).filter(Boolean))] : [];
        const normalizeParameters = value => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([k,v])=>[String(k),String(v||"").trim()]).filter(([k,v])=>allowedParameters.has(k)&&v)) : {};
        const catalog = await readProductsCatalog();
        if (!catalog) throw new Error("Katalog produk tidak tersedia.");
        normalizeCatalog(catalog);
        const products = Array.isArray(catalog?.products) ? catalog.products.map(normalizeProduct) : [];
        const pendingItems = [];

        for (const raw of items) {
            const product = products.find(p => Number(p.id) === Number(raw.id));
            if (!product) return res.status(404).json({ success:false, message:`Produk ID ${raw.id} tidak ditemukan.` });
            const typeName = String(raw.typeName || "");
            const type = product.types.find(t => String(t.typeName) === typeName);
            if (!type) return res.status(400).json({ success:false, message:`Varian ${typeName} tidak ditemukan pada ${product.name}.` });

            const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 0));
            const productOptions = Array.isArray(product.options) ? product.options.map(v=>String(v)) : [];
            const options = normalizeOptions(raw.options);
            if (options.some(option=>!productOptions.includes(option))) return res.status(400).json({success:false,message:`Opsi produk ${product.name} tidak valid.`});
            const requiredParameters = Array.isArray(product.parameters) ? product.parameters.map(String) : [];
            const parameters = normalizeParameters(raw.parameters);
            if (requiredParameters.some(key=>!parameters[key])) return res.status(400).json({success:false,message:`Parameter untuk ${product.name} belum lengkap.`});
            if (typeStock(type) < quantity) return res.status(409).json({ success:false, message:`Stok ${product.name} - ${typeName} tidak mencukupi.` });

            const basePrice = Number(type.price || 0);
            const original = basePrice + optionSurcharge(product, options);
            const starter = coinPayment && starterOfferEligible(user, String(product.name||''), typeName);
            if(starter && quantity!==1) return res.status(400).json({success:false,message:`${product.name} ${typeName} adalah promo pengguna baru dan hanya dapat dibeli 1 unit.`});
            const finalIdr = starter ? 10 : resellerPrice(original,user);
            pendingItems.push({ id:String(product.id), productName:String(product.name || ""), typeName, quantity, priceOriginal:original, priceFinal:finalIdr, durationDays:type.durationDays ?? null, options, parameters, starterOffer:starter });
        }

        const grossIdr = pendingItems.reduce((s,i)=>s+Number(i.priceFinal||0)*i.quantity,0);
        let discountIdr=0, cashbackIdr=0, voucher=null, voucherDb=null;
        if(voucherCode){
          const vd=await readVouchers(); voucherDb=vd;
          voucher=(vd.vouchers||[]).find(v=>String(v.code||'').toUpperCase()===voucherCode && v.active!==false && Number(v.uses||0)<Number(v.maxUses||1) && (!v.expiresAt||new Date(v.expiresAt)>new Date()) && (!v.assignedUserId||v.assignedUserId===user.id));
          if(!voucher)return res.status(404).json({success:false,message:'Voucher tidak tersedia, sudah habis, atau bukan milik akun ini.'});
          if(voucher.type==='discount') discountIdr=voucher.mode==='percent'?Math.floor(grossIdr*Math.min(100,Number(voucher.value)||0)/100):Math.min(grossIdr,Math.floor(Number(voucher.value)||0));
          else cashbackIdr=voucher.mode==='percent'?Math.floor(grossIdr*Math.min(100,Number(voucher.value)||0)/100):Math.min(grossIdr,Math.floor(Number(voucher.value)||0));
        }
        const finalIdr=Math.max(0,grossIdr-discountIdr);
        const totalCoins=Math.ceil(finalIdr/10);
        if(coinPayment){ if(totalCoins<=0)return res.status(400).json({success:false,message:'Total checkout tidak valid.'}); if(wallet.coins<totalCoins)return res.status(409).json({success:false,message:`Saldo koin tidak cukup. Dibutuhkan ${totalCoins} koin, saldo kamu ${wallet.coins} koin.`}); debitCoins(user,totalCoins,'Pembelian produk dengan saldo RYY',{voucherCode}); for(const item of pendingItems){if(item.starterOffer)markStarterOfferUsed(user,item.productName,item.typeName,`pending`);} }
        if(voucher){ voucher.uses=Number(voucher.uses||0)+1; if(voucher.uses>=Number(voucher.maxUses||1))voucher.active=false; await writeVouchers(voucherDb); }

        const pending = {
            id:`purchase_${crypto.randomUUID()}`,
            status:"pending",
            createdAt:new Date().toISOString(),
            targetPhone,
            paymentMethod,
            reseller:user.reseller === true,
            totalItems:pendingItems.reduce((s,i)=>s+i.quantity,0),
            totalSpent:coinPayment ? totalCoins*10 : finalIdr,
            grossTotal:grossIdr,
            discountTotal:discountIdr,
            totalCoins:coinPayment ? totalCoins : 0,
            voucherCode,
            voucherId:voucher?.id||'',
            cashbackIdr,
            cashbackStatus:cashbackIdr>0?'pending':'',
            items:pendingItems,
            proofUrl,
            walletPayment:coinPayment,
            formResponses: {}
        };

        if(cashbackIdr>0){ wallet.cashbackPending.unshift({id:`cashback_${crypto.randomUUID()}`,amountIdr:cashbackIdr,coins:Math.floor(cashbackIdr/10),purchaseId:pending.id,voucherCode,createdAt:new Date().toISOString(),status:'pending'}); pending.cashbackId=wallet.cashbackPending[0].id; }
        for(const item of pendingItems){ if(item.starterOffer) item.starterReservation=pending.id; }
        user.pendingPurchases.unshift(pending);
        user.inbox.unshift({
            id:`msg_${crypto.randomUUID()}`, type:"info", read:false, createdAt:new Date().toISOString(),
            title:"Pesanan masuk sesi menunggu",
            body:coinPayment?"Pembelian dengan saldo koin berhasil dicatat dan sedang menunggu pemeriksaan admin.":"Bukti pembayaran berhasil diterima. Pesanan Anda sedang menunggu pemeriksaan admin.",
            purchaseId:pending.id
        });
        await writeDatabase(database, sha, `Pending checkout ${user.username} - ${pending.id}`);

        // Notify every enabled WhatsApp gateway independently. A gateway
        // failure must never roll back a valid order.
        try {
            const whatsappResults = await notifyAllGatewaysNewOrder(pending);
            pending.whatsappNotifications = whatsappResults.map(x => ({
                gatewayId:x.gatewayId, success:x.success, sentAt:new Date().toISOString(),
                error:x.success ? "" : String(x.error || "").slice(0,300)
            }));
            try {
                const latest = await readDatabase();
                const latestUser = (latest.database.users || []).find(u => u.id === user.id);
                const latestPurchase = latestUser?.pendingPurchases?.find(p => p.id === pending.id);
                if (latestPurchase) latestPurchase.whatsappNotifications = pending.whatsappNotifications;
                if (latestUser) await writeDatabase(latest.database, latest.sha, `Record WhatsApp order notifications ${pending.id}`);
            } catch (persistError) {
                console.warn("Checkout WhatsApp notification metadata skipped:", persistError?.message || persistError);
            }
        } catch (notificationError) {
            console.warn("Checkout WhatsApp notification failed:", notificationError?.message || notificationError);
        }

        return res.status(200).json({
            success:true,
            message:coinPayment?"Checkout saldo RYY dicatat. Koin sudah dicadangkan dan akan dikembalikan jika pesanan ditolak.":"Checkout dicatat dan menunggu konfirmasi admin. Stok belum dikurangi.",
            user:safeUser(user),
            pendingPurchase:pending
        });
    } catch (error) {
        console.error("Checkout pending error:", error);
        const detail = String(error?.message || "").slice(0, 220);
        return res.status(500).json({ success:false, message:"Gagal menyimpan sesi checkout.", detail });
    }
}
