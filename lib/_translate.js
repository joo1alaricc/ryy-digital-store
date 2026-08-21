const TRANSLATE_BASE = "https://api.nexray.eu.cc/tools/translate";

export async function translateText(text, lang) {
  const source = String(text ?? "").trim();
  if (!source) return "";
  if (!["en", "ko"].includes(lang)) return source;

  const url = `${TRANSLATE_BASE}?text=${encodeURIComponent(source)}&lang=${lang}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Translate API ${response.status}`);
    const data = await response.json();
    const translated = data?.result?.translated_text;
    return typeof translated === "string" && translated.trim() ? translated.trim() : source;
  } finally {
    clearTimeout(timeout);
  }
}

export async function translatePair(text) {
  const source = String(text ?? "");
  const [en, ko] = await Promise.allSettled([
    translateText(source, "en"),
    translateText(source, "ko")
  ]);
  return {
    id: source,
    en: en.status === "fulfilled" ? en.value : source,
    ko: ko.status === "fulfilled" ? ko.value : source
  };
}
