// Provider-returned units only. No guessed USD costs or text/token conversions.
export function extractProviderUsage(data: unknown) {
  const root = data && typeof data === "object" ? data as Record<string, any> : {};
  const usage = root.usageMetadata ?? root.usage ?? {};
  const unit = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
  return {
    input_tokens: unit(usage.promptTokenCount ?? usage.prompt_tokens ?? usage.input_tokens),
    output_tokens: unit(usage.candidatesTokenCount ?? usage.completion_tokens ?? usage.output_tokens),
    cached_input_tokens: unit(usage.cachedContentTokenCount ?? usage.prompt_tokens_details?.cached_tokens),
    usage_units: {
      total_tokens: unit(usage.totalTokenCount ?? usage.total_tokens),
      reasoning_tokens: unit(usage.thoughtsTokenCount ?? usage.completion_tokens_details?.reasoning_tokens),
      input_modalities: usage.promptTokensDetails ?? null,
      output_modalities: usage.candidatesTokensDetails ?? null,
    },
  };
}