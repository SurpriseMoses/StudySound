export type Scenario = {
  subscribers: number; premiumShare: number; redeemedShare: number; newGenerationShare: number;
  newCostPerCredit: number | null; cachedCostPerCredit: number | null; feePercent: number | null;
  feePerPayment: number | null; otherVariablePerSubscriber: number | null;
  creditsPerRand: number | null; safetyMargin: number;
};
export function rewardExposure(rate: number | null, cost: number | null, margin: number) {
  if (rate === null || cost === null) return null;
  if (![rate, cost, margin].every(Number.isFinite) || rate <= 0 || cost < 0 || margin < 0) throw new Error("Invalid exposure assumptions");
  return { standardCredits: 79 * rate, ambassadorCredits: 149 * rate, annualCredits: (7 * 79 + 149) * rate,
    annualCost: (7 * 79 + 149) * rate * cost, annualReserve: (7 * 79 + 149) * rate * cost * (1 + margin) };
}
export function cohortScenario(s: Scenario) {
  for (const share of [s.premiumShare, s.redeemedShare, s.newGenerationShare]) if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error("Invalid share");
  if (!Number.isSafeInteger(s.subscribers) || s.subscribers <= 0) throw new Error("Invalid cohort");
  const normalRevenue = s.subscribers * (79 * (1 - s.premiumShare) + 149 * s.premiumShare);
  const collectedScenario = normalRevenue * 0.9;
  const commissions = normalRevenue * 0.05;
  const credits = s.subscribers * (110 * (1 - s.premiumShare) + 220 * s.premiumShare);
  const ai = s.newCostPerCredit === null || s.cachedCostPerCredit === null ? null : credits * s.redeemedShare * (s.newGenerationShare * s.newCostPerCredit + (1 - s.newGenerationShare) * s.cachedCostPerCredit);
  const fees = s.feePercent === null || s.feePerPayment === null ? null : collectedScenario * s.feePercent / 100 + s.subscribers * s.feePerPayment;
  // One referrer, one year's cap, plus the one-time Ambassador award.
  const standardAwards = Math.min(7, Math.floor(s.subscribers / 50));
  const rewardCredits = s.creditsPerRand === null ? null : (standardAwards * 79 + (s.subscribers >= 300 ? 149 : 0)) * s.creditsPerRand;
  const rewardReserve = rewardCredits === null || s.newCostPerCredit === null ? null : rewardCredits * s.newCostPerCredit * (1 + s.safetyMargin);
  const contribution = ai === null || fees === null || rewardReserve === null || s.otherVariablePerSubscriber === null ? null : collectedScenario - commissions - ai - fees - rewardReserve - s.subscribers * s.otherVariablePerSubscriber;
  return { normalRevenue, collectedScenario, commissions, credits, ai, fees, standardAwards, rewardCredits, rewardReserve, contribution };
}