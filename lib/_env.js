let runtimeEnv = Object.create(null);
export const ENV_OVERRIDES_KEY = "ryy:env-overrides:v1";

export function setRuntimeEnv(env) {
  runtimeEnv = env || Object.create(null);
}

export async function hydrateRuntimeEnv() {
  const store = runtimeEnv?.STORE_KV;
  if (!store || typeof store.get !== "function") return runtimeEnv;
  try {
    const overrides = await store.get(ENV_OVERRIDES_KEY, "json");
    if (!overrides || typeof overrides !== "object") return runtimeEnv;
    const safe = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(key)) continue;
      if (["STORE_KV","ASSETS","INBOX_KV"].includes(key)) continue;
      safe[key] = value === undefined || value === null ? "" : String(value);
    }
    runtimeEnv = { ...runtimeEnv, ...safe };
  } catch (error) {
    console.warn("ENV override load failed:", error?.message || error);
  }
  return runtimeEnv;
}

export function env(name, fallback = "") {
  const value = runtimeEnv?.[name];
  return value === undefined || value === null ? fallback : String(value);
}

export function binding(name) {
  return runtimeEnv?.[name] ?? null;
}

export function hasBinding(name) {
  return Boolean(runtimeEnv?.[name]);
}
