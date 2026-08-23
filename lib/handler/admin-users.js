import { readDatabase, writeDatabase } from "../_github.js";
import { verifyAdminToken } from "../_admin.js";
import { safeUser } from "../_store.js";
import crypto from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

function adminSafeUser(user) {
  const copy = { ...safeUser(user) };
  copy.googleId = user.googleId || "";
  copy.googleEmail = user.googleEmail || "";
  copy.authProvider = user.authProvider || "";
  copy.createdAt = user.createdAt || "";
  copy.lastLoginAt = user.lastLoginAt || "";
  copy.lastLoginIp = user.lastLoginIp || "";
  copy.lastLoginDevice = user.lastLoginDevice || "";
  copy.lastLoginBrowser = user.lastLoginBrowser || "";
  copy.failedLoginAttempts = Number(user.failedLoginAttempts || 0);
  copy.passwordHistory = Array.isArray(user.passwordHistory) ? user.passwordHistory.map(x => ({ changedAt:x.changedAt || "" })) : [];
  copy.status = {
    banned: user.status?.banned === true || user.banned === true,
    suspended: user.status?.suspended === true || user.suspended === true,
    reseller: user.reseller === true
  };
  copy.purchaseHistory = (user.pendingPurchases || []).map(p => ({
    id:p.id, status:p.status, createdAt:p.createdAt, totalItems:p.totalItems, totalSpent:p.totalSpent,
    items:Array.isArray(p.items) ? p.items.map(i => ({productName:i.productName,typeName:i.typeName,quantity:i.quantity,priceFinal:i.priceFinal})) : [],
    adminNote:p.adminNote || "", delivery:p.delivery || null
  }));
  copy.refundHistory = (user.supportRequests || []).filter(r => r.type === "refund").map(r => ({id:r.id,status:r.status,createdAt:r.createdAt,productName:r.productName,typeName:r.typeName,calculation:r.calculation || null}));
  copy.warrantyHistory = (user.supportRequests || []).filter(r => r.type === "warranty").map(r => ({id:r.id,status:r.status,createdAt:r.createdAt,productName:r.productName,duration:r.duration,errorDate:r.errorDate,reason:r.reason}));
  return copy;
}

function auth(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return verifyAdminToken(token);
}

function ensureUserCollections(user) {
  user.reseller = user.reseller === true;
  user.subscriptions = Array.isArray(user.subscriptions) ? user.subscriptions : [];
  user.pendingPurchases = Array.isArray(user.pendingPurchases) ? user.pendingPurchases : [];
  user.supportRequests = Array.isArray(user.supportRequests) ? user.supportRequests : [];
  user.status = user.status && typeof user.status === "object" ? user.status : {};
  user.status.banned = user.status.banned === true;
  user.status.suspended = user.status.suspended === true;
  user.failedLoginAttempts = Number(user.failedLoginAttempts || 0);
  user.passwordHistory = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
  user.subscriptions.forEach(sub => {
    sub.status = sub.status === "inactive" ? "inactive" : "active";
    if (sub.pausedRemainingMs !== undefined) {
      const n = Number(sub.pausedRemainingMs);
      sub.pausedRemainingMs = Number.isFinite(n) ? Math.max(0, n) : 0;
    }
  });
}

function findUser(database, userId) {
  const index = database.users.findIndex(u => u.id === userId);
  return { index, user: index >= 0 ? database.users[index] : null };
}

function findSubscription(user, subscriptionId) {
  const index = user.subscriptions.findIndex(s => String(s.id) === String(subscriptionId));
  return { index, subscription: index >= 0 ? user.subscriptions[index] : null };
}

function applySubscriptionToggle(subscription, enabled) {
  const now = Date.now();
  if (enabled) {
    if (subscription.expiresAt) {
      let remaining = Number(subscription.pausedRemainingMs);
      if (!Number.isFinite(remaining)) {
        const currentExpiry = new Date(subscription.expiresAt).getTime();
        remaining = Number.isFinite(currentExpiry) ? Math.max(0, currentExpiry - now) : 0;
      }
      subscription.expiresAt = new Date(now + Math.max(0, remaining)).toISOString();
      delete subscription.pausedRemainingMs;
      delete subscription.pausedAt;
    }
    subscription.status = "active";
    subscription.resumedAt = new Date(now).toISOString();
    return;
  }

  if (subscription.expiresAt) {
    const expiry = new Date(subscription.expiresAt).getTime();
    subscription.pausedRemainingMs = Number.isFinite(expiry) ? Math.max(0, expiry - now) : 0;
    subscription.pausedAt = new Date(now).toISOString();
  }
  subscription.status = "inactive";
  subscription.pausedAt = new Date(now).toISOString();
}

function adjustSubscription(subscription, deltaMinutes, setRemainingMinutes) {
  const now = Date.now();
  if (!subscription.expiresAt) return;

  let remaining;
  if (subscription.status === "inactive") {
    remaining = Number(subscription.pausedRemainingMs);
    if (!Number.isFinite(remaining)) remaining = 0;
  } else {
    const expiry = new Date(subscription.expiresAt).getTime();
    remaining = Number.isFinite(expiry) ? Math.max(0, expiry - now) : 0;
  }

  if (setRemainingMinutes !== undefined && setRemainingMinutes !== null && setRemainingMinutes !== "") {
    const minutes = Number(setRemainingMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error("Sisa durasi harus berupa angka menit 0 atau lebih.");
    remaining = Math.floor(minutes * 60 * 1000);
  } else {
    const delta = Number(deltaMinutes || 0);
    if (!Number.isFinite(delta)) throw new Error("Perubahan durasi tidak valid.");
    remaining = Math.max(0, remaining + Math.trunc(delta * 60 * 1000));
  }

  if (subscription.status === "inactive") {
    subscription.pausedRemainingMs = remaining;
  } else {
    subscription.expiresAt = new Date(now + remaining).toISOString();
  }

  subscription.durationDays = remaining > 0 ? Number((remaining / DAY_MS).toFixed(6)) : 0;
  subscription.reminderSentAt = "";
  subscription.reminderForExpiryAt = "";
}

export default async function handler(req, res) {
  const admin = auth(req);
  if (!admin) return res.status(401).json({ success:false, message:"Sesi admin tidak valid atau sudah kedaluwarsa." });

  try {
    const { database, sha } = await readDatabase();
    database.users ||= [];
    database.users.forEach(ensureUserCollections);

    if (req.method === "GET") {
      const users = database.users.map(adminSafeUser);
      return res.status(200).json({ success:true, users });
    }

    if (req.method === "PATCH") {
      const body = req.body || {};
      const { userId, action = "user" } = body;
      const { index, user } = findUser(database, userId);
      if (index < 0 || !user) return res.status(404).json({ success:false, message:"User tidak ditemukan." });

      // User ID, username, email, and secondary contact remain immutable.
      // The profile photo URL is intentionally editable by admin for moderation/support.
      if (body.username !== undefined || body.email !== undefined || body.secondaryContact !== undefined) {
        return res.status(400).json({ success:false, message:"User ID, username, email, dan kontak tambahan tidak dapat diedit admin." });
      }

      if (action === "status") {
        const key = String(body.statusKey || "");
        if (!["banned","suspended","reseller"].includes(key) || typeof body.enabled !== "boolean") return res.status(400).json({ success:false, message:"Status akun tidak valid." });
        if (key === "reseller") user.reseller = body.enabled;
        else user.status[key] = body.enabled;
      } else if (action === "reseller") {
        if (typeof body.enabled !== "boolean") return res.status(400).json({ success:false, message:"Status reseller tidak valid." });
        user.reseller = body.enabled;
      } else if (action === "subscriptionToggle") {
        const { subscription } = findSubscription(user, body.subscriptionId);
        if (!subscription) return res.status(404).json({ success:false, message:"Langganan tidak ditemukan." });
        if (typeof body.enabled !== "boolean") return res.status(400).json({ success:false, message:"Status langganan tidak valid." });
        applySubscriptionToggle(subscription, body.enabled);
      } else if (action === "subscriptionEdit") {
        const { subscription } = findSubscription(user, body.subscriptionId);
        if (!subscription) return res.status(404).json({ success:false, message:"Langganan tidak ditemukan." });
        if (body.productName !== undefined) subscription.productName = String(body.productName || "Produk").trim() || "Produk";
        if (body.typeName !== undefined) subscription.typeName = String(body.typeName || "").trim();
        if (body.deltaMinutes !== undefined || body.setRemainingMinutes !== undefined) {
          adjustSubscription(subscription, body.deltaMinutes, body.setRemainingMinutes);
        }
      } else if (action === "subscriptionDelete") {
        const { index: subIndex, subscription } = findSubscription(user, body.subscriptionId);
        if (subIndex < 0 || !subscription) return res.status(404).json({ success:false, message:"Langganan tidak ditemukan." });
        user.subscriptions.splice(subIndex, 1);
      } else if (action === "user") {
        if (body.displayName !== undefined) user.displayName = String(body.displayName || user.username).trim() || user.username;
        if (body.phone !== undefined) user.phone = String(body.phone || "").trim();
        if (body.avatar !== undefined) user.avatar = String(body.avatar || "").trim();
        if (body.totalItemsBought !== undefined) user.totalItemsBought = Math.max(0, Number(body.totalItemsBought) || 0);
        if (body.totalMoneySpent !== undefined) user.totalMoneySpent = Math.max(0, Number(body.totalMoneySpent) || 0);
        if (body.failedLoginAttempts !== undefined) user.failedLoginAttempts = Math.max(0, Math.floor(Number(body.failedLoginAttempts) || 0));
        if (body.password !== undefined && String(body.password).trim()) {
          const password = String(body.password);
          if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
            return res.status(400).json({ success:false, message:"Password baru minimal 8 karakter dan harus berisi huruf, angka, serta simbol." });
          }
          const salt = crypto.randomBytes(16).toString("hex");
          const hash = crypto.scryptSync(password, salt, 64).toString("hex");
          user.passwordHash = `${salt}:${hash}`;
          user.passwordHistory ||= [];
          user.passwordHistory.unshift({ changedAt:new Date().toISOString(), changedBy:"admin" });
          user.passwordHistory = user.passwordHistory.slice(0, 20);
        }
      } else {
        return res.status(400).json({ success:false, message:"Action admin tidak dikenal." });
      }

      await writeDatabase(database, sha, `Admin ${action} for ${user.username}`);
      return res.status(200).json({ success:true, message:"Perubahan berhasil disimpan.", user:adminSafeUser(user) });
    }

    if (req.method === "DELETE") {
      const userId = req.query.userId;
      const { index } = findUser(database, userId);
      if (index < 0) return res.status(404).json({ success:false, message:"User tidak ditemukan." });
      const username = database.users[index].username;
      database.users.splice(index,1);
      database.settings ||= {};
      database.settings.totalBuyers = database.users.length;
      await writeDatabase(database, sha, `Admin delete user ${username}`);
      return res.status(200).json({ success:true, message:"Akun user berhasil dihapus." });
    }

    return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
  } catch (error) {
    console.error("Admin users error:", error);
    return res.status(500).json({ success:false, message:error?.message || "Gagal memproses data user." });
  }
}
