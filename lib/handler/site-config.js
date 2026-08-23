import { readRepoJson, readKVJson } from "../_github.js";
import { getOtherTools, ensureOtherToolsLoaded } from "../other-tools.js";
// Feature modules self-register their own IDs.

const SITE_CONFIG_KV_KEY = "ryy:site-config:v1";
const OTHER_TOOLS_KV_KEY = "ryy:other-tools:v1";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
  try {
    const registeredTools = await ensureOtherToolsLoaded();
    let config = await readKVJson(SITE_CONFIG_KV_KEY);
    if(!config){ try { ({ data: config } = await readRepoJson("config.json")); } catch (_) {} }
    config ||= {};
    const toolConfig = await readKVJson(OTHER_TOOLS_KV_KEY);
    const toolMap = new Map(Array.isArray(toolConfig) ? toolConfig.map(x => [String(x?.id), x]) : []);
    const otherTools = registeredTools
      .filter(tool => {
        const found = toolMap.get(tool.id);
        return found ? found.enabled === true : tool.defaultEnabled === true;
      })
      .map(x=>({id:x.id,name:x.name,description:x.description}));
    const maintenance = config?.maintenance === true;
    const font = config?.font && typeof config.font === "object" ? config.font : { family:"san-francisco", weight:600 };
    const uiMode = config?.uiMode === "blur" ? "blur" : "liquid-glass";
    return res.status(200).json({
      success:true,
      maintenance,
      font: { family: String(font.family || "san-francisco"), weight: Number(font.weight) || 600 },
      uiMode,
      otherTools,
      whatsappLink: String(config?.whatsappLink || "")
    });
  } catch (error) {
    console.error("Site config error:", error);
    return res.status(200).json({ success:true, maintenance:false, font:{family:"san-francisco",weight:600}, uiMode:"liquid-glass", otherTools:[{id:"video-downloader",name:"Downloader video all platform",description:"Download video/audio dari berbagai platform."}] });
  }
}
