import { safeWallet } from "./_finance.js";

export function typeStock(type) {
    return Math.max(0, Math.floor(Number(type?.stock) || 0));
}

export function productStock(product) {
    return (Array.isArray(product?.types) ? product.types : [])
        .reduce((sum, type) => sum + typeStock(type), 0);
}

export function isReseller(user) {
    return user?.reseller === true;
}

export function resellerPrice(price, user) {
    const original = Math.max(0, Number(price) || 0);
    return isReseller(user) && original >= 8000
        ? Math.max(0, original - 2000)
        : original;
}

export function safeUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        email: user.email || "",
        phone: user.phone || "",
        secondaryContact: user.secondaryContact || "",
        displayName: user.displayName || user.username,
        avatar: user.avatar || "",
        googleEmail: user.googleEmail || "",
        totalItemsBought: Number(user.totalItemsBought || 0),
        totalMoneySpent: Number(user.totalMoneySpent || 0),
        reseller: user.reseller === true,
        subscriptions: Array.isArray(user.subscriptions) ? user.subscriptions : [],
        pendingPurchases: Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [],
        inbox: Array.isArray(user.inbox) ? user.inbox : [],
        supportRequests: Array.isArray(user.supportRequests) ? user.supportRequests : [],
        wallet: safeWallet(user)
    };
}

export function optionSurcharge(product, options=[]) {
    const prices = product?.optionPrices && typeof product.optionPrices === "object" ? product.optionPrices : {};
    const list = Array.isArray(options) ? options : [];
    return list.reduce((sum, option) => sum + Math.max(0, Math.floor(Number(prices[String(option)] || 0))), 0);
}


export function normalizeCatalog(data) {
    if (!data || typeof data !== "object") return data;
    const products = Array.isArray(data.products) ? data.products : [];
    const specialNames = new Map([["Pulsa All Provider","24"],["E-Money All Provider","25"]]);
    const used = new Set();
    // Reserve the requested special IDs first.
    for (const p of products) { const wanted=specialNames.get(String(p?.name||"")); if(wanted){ p.id=wanted; p.category="Service"; } }
    let max = products.reduce((m,p)=>Math.max(m,Number(p?.id)||0),0);
    for (const p of products) {
        let id=String(p?.id??"").trim();
        if(!/^\d+$/.test(id) || used.has(id)) { do { id=String(++max); } while(used.has(id) || id==="24" || id==="25"); p.id=id; }
        used.add(id);
    }
    data.categories=["Semua",...new Set(products.map(p=>String(p?.category||"").trim()).filter(Boolean))];
    data.products=products;
    return data;
}
export function normalizeProduct(product) {
    if (!product || typeof product !== "object") return product;
    product.types = Array.isArray(product.types) ? product.types : [];
    product.types.forEach(type => {
        type.stock = typeStock(type);
        if (type.durationDays !== null && type.durationDays !== undefined) {
            const days = Number(type.durationDays);
            type.durationDays = Number.isFinite(days) && days > 0 ? days : null;
        } else {
            type.durationDays = null;
        }
    });
    product.stock = productStock(product);
    return product;
}
