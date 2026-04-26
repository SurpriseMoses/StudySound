// ─────────────────────────────────────────────────────────────────────────────
// Canonical cost model — used by EVERY admin dashboard card.
// Change values here once → updates Overview / Economy / Top Documents.
// ─────────────────────────────────────────────────────────────────────────────

// Revenue
export const CREDIT_PRICE_ZAR = 1.0;          // R1 charged to user per credit
export const CHARS_PER_CREDIT = 1800;         // 1 credit unlocks ~1,800 chars

// FX
export const USD_TO_ZAR = 17;                 // fixed for now

// Azure TTS raw price
export const AZURE_TTS_USD_PER_1M_CHARS = 16; // $16 / 1M chars
export const RAW_COST_PER_1000_CHARS_ZAR =
  (AZURE_TTS_USD_PER_1M_CHARS / 1000) * USD_TO_ZAR; // = R0.272

// Adjusted (true) operating cost — accounts for SSML overhead, retries,
// chunk inefficiency, infra. Default R0.32 /1000 chars.
export const REAL_COST_PER_1000_CHARS_ZAR = 0.32;

// Derived per-credit costs
export const RAW_COST_PER_CREDIT_ZAR =
  (CHARS_PER_CREDIT / 1000) * RAW_COST_PER_1000_CHARS_ZAR;       // ≈ R0.49
export const REAL_COST_PER_CREDIT_ZAR =
  (CHARS_PER_CREDIT / 1000) * REAL_COST_PER_1000_CHARS_ZAR;      // ≈ R0.58

// Translation & visuals (kept for legacy Economy page)
export const COST_USD = {
  translation_per_chunk: 0.018,
  audio_per_chunk:       0.027,
  visual_per_scene:      0.10,
} as const;

// ─── helpers ─────────────────────────────────────────────────────────────────
export const usdToZar     = (usd: number) => usd * USD_TO_ZAR;
export const creditsToZAR = (credits: number) => credits * CREDIT_PRICE_ZAR;

/** Cost (ZAR) for N characters at the canonical real operating rate. */
export const costForCharsZar = (chars: number, raw = false) =>
  (chars / 1000) * (raw ? RAW_COST_PER_1000_CHARS_ZAR : REAL_COST_PER_1000_CHARS_ZAR);

/** Estimate ZAR cost from feature generation counts (legacy fallback). */
export function estimateCostsZar(opts: {
  audio_generated: number;
  translation_generated: number;
  visual_generated: number;
}) {
  const audio_usd = opts.audio_generated * COST_USD.audio_per_chunk;
  const translation_usd = opts.translation_generated * COST_USD.translation_per_chunk;
  const visual_usd = opts.visual_generated * COST_USD.visual_per_scene;
  return {
    audio:       usdToZar(audio_usd),
    translation: usdToZar(translation_usd),
    visual:      usdToZar(visual_usd),
    total:       usdToZar(audio_usd + translation_usd + visual_usd),
  };
}

export const formatZar = (n: number) =>
  `R${(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatPct = (n: number, digits = 1) =>
  `${(n ?? 0).toFixed(digits)}%`;
