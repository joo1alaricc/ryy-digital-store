// Self-registering Other Tools registry.
// Every tool owns its stable ID and registers itself when its module is loaded.
// Load feature modules statically so Cloudflare Pages/esbuild always bundles them.
// Each feature still owns its own stable ID and self-registers on module load.
import "./tools/downloader.js";

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
const TOOL_MODULES = [];

export async function ensureOtherToolsLoaded() {
  // Modules are statically imported above. This function remains async so all
  // existing consumers keep the same API without using runtime dynamic imports.
  if (!bootstrapPromise) bootstrapPromise = Promise.resolve();
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
