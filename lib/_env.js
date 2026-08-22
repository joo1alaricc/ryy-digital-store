let runtimeEnv = Object.create(null);

export function setRuntimeEnv(env) {
  runtimeEnv = env || Object.create(null);
}

export function env(name, fallback = "") {
  const value = runtimeEnv?.[name];
  return value === undefined || value === null ? fallback : String(value);
}

// Raw Cloudflare bindings (KV, ASSETS, etc.). Do not stringify these values.
export function binding(name) {
  return runtimeEnv?.[name] ?? null;
}

export function hasBinding(name) {
  return Boolean(runtimeEnv?.[name]);
}
