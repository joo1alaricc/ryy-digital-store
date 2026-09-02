const GOOGLE_TRANSLATE_BASE = "https://translate.google.com/translate_a/single";

function normalizeLanguage(lang) {
  const code = String(lang || "").trim().toLowerCase();
  return code === "en" || code === "ko" ? code : "";
}

/**
 * Translate text through Google Translate's public translation endpoint.
 * This keeps the existing Cloudflare Worker architecture dependency-free while
 * using the same Google Translate service expected by translate-google-api.
 */
export async function translateText(text, lang) {
  const source = String(text ?? "").trim();
  const target = normalizeLanguage(lang);
  if (!source || !target) return source;

  const params = new URLSearchParams();
  params.set("client", "gtx");
  params.set("sl", "auto");
  params.set("tl", target);
  params.set("hl", target);
  params.set("dt", "t");
  params.set("ie", "UTF-8");
  params.set("oe", "UTF-8");
  params.set("q", source);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${GOOGLE_TRANSLATE_BASE}?${params.toString()}`, {
      method: "GET",
      headers: {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 RYY-STORE"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Google Translate API ${response.status}`);
    const data = await response.json();
    const translated = Array.isArray(data?.[0])
      ? data[0].map(segment => Array.isArray(segment) ? String(segment[0] || "") : "").join("").trim()
      : "";
    return translated || source;
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
