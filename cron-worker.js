import inboxCleanup from "./lib/handler/inbox-cleanup.js";
import subscriptionReminders from "./lib/handler/subscription-reminders.js";
import { setRuntimeEnv } from "./lib/_env.js";

function makeRes() {
  let statusCode = 200;
  const headers = new Headers();
  let payload = "";
  return {
    status(code) { statusCode = code; return this; },
    setHeader(name, value) { headers.set(name, Array.isArray(value) ? value.join(", ") : String(value)); return this; },
    json(data) { payload = JSON.stringify(data); headers.set("content-type", "application/json; charset=utf-8"); return this; },
    response() { return new Response(payload, { status: statusCode, headers }); }
  };
}

async function run(handler, env, path) {
  setRuntimeEnv(env);
  const req = {
    method: "POST",
    headers: { authorization: `Bearer ${env.CRON_SECRET || ""}` },
    query: {},
    url: `https://cron.internal/api/${path}`,
    body: {},
    bodyUsed: false
  };
  const res = makeRes();
  await handler(req, res);
  const response = res.response();
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`);
}

export default {
  async scheduled(controller, env) {
    try {
      if (controller.cron === "0 0 * * *") await run(inboxCleanup, env, "inbox-cleanup");
      if (controller.cron === "0 1 * * *") await run(subscriptionReminders, env, "subscription-reminders");
    } catch (error) {
      console.error("RYY STORE cron error:", error);
      controller.noRetry?.();
    }
  }
};
