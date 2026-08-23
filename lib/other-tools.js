// Self-registering Other Tools registry.
// Every tool owns its stable ID and registers itself when its module is loaded.
const registry = new Map();

export function registerOtherTool(tool) {
  if (!tool || !tool.id) throw new Error("Other Tool wajib memiliki id.");
  const id = String(tool.id).trim();
  if (!id) throw new Error("Other Tool id tidak valid.");
  registry.set(id, {
    id,
    name: String(tool.name || id),
    description: String(tool.description || ""),
    defaultEnabled: tool.defaultEnabled !== false
  });
  return registry.get(id);
}

let bootstrapPromise = null;

// The registry is intentionally owned by each feature module. This loader only
// makes sure feature modules have executed before a consumer reads the registry.
// Add future tool modules here, never in admin-config/site-config.
const TOOL_MODULES = [
  "./tools/downloader.js"
];

export async function ensureOtherToolsLoaded() {
  if (!bootstrapPromise) {
    bootstrapPromise = Promise.all(TOOL_MODULES.map(path => import(path))).catch(error => {
      bootstrapPromise = null;
      throw error;
    });
  }
  await bootstrapPromise;
  return getOtherTools();
}

export function getOtherTools() {
  return [...registry.values()].map(x => ({ ...x }));
}

export function getOtherTool(id) {
  return registry.get(String(id)) || null;
}

export default registry;
