import adminLogin from "../lib/handler/admin-login.js";
import adminPurchases from "../lib/handler/admin-purchases.js";
import adminUsers from "../lib/handler/admin-users.js";
import adminProducts from "../lib/handler/admin-products.js";
import adminConfig from "../lib/handler/admin-config.js";
import siteConfig from "../lib/handler/site-config.js";
import chat from "../lib/handler/chat.js";
import checkout from "../lib/handler/checkout.js";
import data from "../lib/handler/data.js";
import distributor from "../lib/handler/distributor.js";
import googleConfig from "../lib/handler/google-config.js";
import googleLogin from "../lib/handler/google-login.js";
import login from "../lib/handler/login.js";
import me from "../lib/handler/me.js";
import products from "../lib/handler/products.js";
import register from "../lib/handler/register.js";
import sendOtp from "../lib/handler/send-otp.js";
import verifyOtp from "../lib/handler/verify-otp.js";
import updateUser from "../lib/handler/update-user.js";
import uploadImage from "../lib/handler/upload-image.js";
import inbox from "../lib/handler/inbox.js";
import chatting from "../lib/handler/chatting.js";
import support from "../lib/handler/support.js";
import inboxCleanup from "../lib/handler/inbox-cleanup.js";
import subscriptionReminders from "../lib/handler/subscription-reminders.js";
import adminSupport from "../lib/handler/admin-support.js";
import adminImpersonate from "../lib/handler/admin-impersonate.js";
import health from "../lib/handler/health.js";

const handlers = {
  "admin-login": adminLogin,
  "admin-purchases": adminPurchases,
  "admin-users": adminUsers,
  "admin-products": adminProducts,
  "admin-config": adminConfig,
  "site-config": siteConfig,
  chat,
  checkout,
  data,
  distributor,
  "google-config": googleConfig,
  "google-login": googleLogin,
  login,
  me,
  products,
  register,
  "send-otp": sendOtp,
  "verify-otp": verifyOtp,
  "update-user": updateUser,
  "upload-image": uploadImage,
  inbox,
  chatting,
  support,
  "inbox-cleanup": inboxCleanup,
  "subscription-reminders": subscriptionReminders,
  "admin-support": adminSupport,
  "admin-impersonate": adminImpersonate,
  health
};

function getRoute(req) {
  const queryRoute = req.query?.route || req.query?.path;
  if (typeof queryRoute === "string" && queryRoute) {
    return queryRoute.replace(/^\/+|\/+$/g, "").split("?")[0];
  }

  const rawUrl = String(req.url || "");
  try {
    const pathname = new URL(rawUrl, "http://localhost").pathname;
    return pathname.replace(/^\/api\/?/, "").replace(/^\/+|\/+$/g, "").split("/")[0];
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  const route = getRoute(req);
  const target = handlers[route];

  if (!target) {
    return res.status(404).json({
      success: false,
      message: "API route tidak ditemukan."
    });
  }

  try {
    return await target(req, res);
  } catch (error) {
    console.error(`API ${route} error:`, error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Terjadi kesalahan pada server."
      });
    }
  }
}
