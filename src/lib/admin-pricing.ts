// Business pricing constants for admin dashboard.
// All editable here — change once, updates Overview / Economy / Top Documents.
//
// Revenue model: each credit consumed = R{CREDIT_PRICE_ZAR} of revenue.
// Cost model: per-unit USD cost × FX rate.

export const CREDIT_PRICE_ZAR = 1.0;          // R1 per credit
export const USD_TO_ZAR = 18.5;               // configurable FX

// Per-unit USD cost approximations (per spec §8)
export const COST_USD = {
  translation_per_chunk: 0.018,
  audio_per_chunk:       0.027,
  visual_per_scene:      0.10,
} as const;

export const usdToZar = (usd: number) => usd * USD_TO_ZAR;
export const creditsToZAR = (credits: number) => credits * CREDIT_PRICE_ZAR;

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
  `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
