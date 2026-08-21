let runtimeEnv = Object.create(null);

export function setRuntimeEnv(env) {
  runtimeEnv = env || Object.create(null);
}

export function env(name, fallback = "") {
  const value = runtimeEnv?.[name];
  return value === undefined || value === null ? fallback : String(value);
}
