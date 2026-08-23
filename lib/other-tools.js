// Self-registering Other Tools registry. Each feature owns a stable ID.
const registry = [
  { id: "video-downloader", name: "Downloader video all platform", description: "Download video/audio dari berbagai platform." },
  { id: "pinterest-search", name: "Searching pinterest image", description: "Cari gambar Pinterest dengan cepat." }
];
export function getOtherTools(){ return registry.map(x=>({...x})); }
export function getOtherTool(id){ return registry.find(x=>x.id===String(id)); }
export default registry;
