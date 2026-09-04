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
    const webThemes=["liquid-glass","minimalist","liquid-glass-solid","neumorphic"];
    const webTheme=webThemes.includes(config?.webTheme)?config.webTheme:"liquid-glass";
    const accents={"Sky Blue":{hex:"#38bdf8",glow:"rgba(2,132,199,.28)"},"Teal":{hex:"#0d9488",glow:"rgba(17,94,89,.28)"},"Lilac":{hex:"#9d4edd",glow:"rgba(123,44,191,.28)"},"Moss Green":{hex:"#4d908e",glow:"rgba(39,76,74,.28)"},"Maroon":{hex:"#800020",glow:"rgba(92,0,23,.28)"},"Lavender":{hex:"#b79ced",glow:"rgba(144,122,214,.28)"},"Pink Sakura":{hex:"#ff70a6",glow:"rgba(255,71,126,.28)"},"Midnight":{hex:"#1d3557",glow:"rgba(11,19,41,.28)"},"Mint":{hex:"#2ec4b6",glow:"rgba(32,156,144,.28)"},"Charcoal":{hex:"#4a4e69",glow:"rgba(34,34,59,.28)"}};
    const accentName=String(config?.accent?.name||"Lavender");
    const accentBase=accents[accentName]||accents.Lavender;
    const accent={name:accentName in accents?accentName:"Lavender",...accentBase};
    return res.status(200).json({
      success:true,
      maintenance,
      font: { family: String(font.family || "san-francisco"), weight: Number(font.weight) || 600 },
      uiMode,
      webTheme,
      accent,
      otherTools,
      whatsappLink: String(config?.whatsappLink || "")
    });
  } catch (error) {
    console.error("Site config error:", error);
    return res.status(200).json({ success:true, maintenance:false, font:{family:"san-francisco",weight:600}, uiMode:"liquid-glass", webTheme:"liquid-glass", accent:{name:"Lavender",hex:"#b79ced",glow:"rgba(144,122,214,.28)"}, otherTools:[{id:"video-downloader",name:"Downloader video all platform",description:"Download video/audio dari berbagai platform."}] });
  }
}
