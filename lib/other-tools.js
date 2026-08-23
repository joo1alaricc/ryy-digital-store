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

export function getOtherTools() {
  return [...registry.values()].map(x => ({ ...x }));
}

export function getOtherTool(id) {
  return registry.get(String(id)) || null;
}

export default registry;
