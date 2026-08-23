import { readRepoJson, readKVJson } from "../_github.js";
import { getOtherTools } from "../other-tools.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });
  try {
    let config = await readKVJson("ryy:site-config:v1");
    if(!config){ try { ({ data: config } = await readRepoJson("config.json")); } catch (_) {} }
    config ||= {};
    const maintenance = config?.maintenance === true;
    const font = config?.font && typeof config.font === "object" ? config.font : { family:"san-francisco", weight:600 };
    const uiMode = config?.uiMode === "blur" ? "blur" : "liquid-glass";
    return res.status(200).json({
      success:true,
      maintenance,
      font: { family: String(font.family || "san-francisco"), weight: Number(font.weight) || 600 },
      uiMode,
      otherTools: getOtherTools().filter(tool=>Array.isArray(config?.otherTools) && config.otherTools.some(x=>String(x?.id)===tool.id && x.enabled===true)).map(x=>({id:x.id,name:x.name,description:x.description})),
      whatsappLink: String(config?.whatsappLink || "")
    });
  } catch (error) {
    console.error("Site config error:", error);
    return res.status(200).json({ success:true, maintenance:false, font:{family:"san-francisco",weight:600}, uiMode:"liquid-glass" });
  }
}
