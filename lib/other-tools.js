// Other Tools registry facade.
// Feature modules own their IDs and self-register when statically imported.
import { registerOtherTool, getOtherTools, getOtherTool } from "./tools/registry.js";
import "./tools/downloader.js";

let bootstrapPromise = null;

export { registerOtherTool, getOtherTools, getOtherTool };

export async function ensureOtherToolsLoaded() {
  // Feature modules are statically bundled. Import evaluation has completed
  // before this module can be consumed, so no runtime dynamic import is used.
  if (!bootstrapPromise) bootstrapPromise = Promise.resolve();
  await bootstrapPromise;
  return getOtherTools();
}

export default { registerOtherTool, getOtherTools, getOtherTool };
