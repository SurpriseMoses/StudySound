// Pure server-side rules. Persistent eligibility, locks and authorisation must
// be enforced by database transactions before any of these quotes are awarded.
export const REFERRAL_DEFAULTS = Object.freeze({
  attributionDays: 30,
  discountBasisPoints: 1000,
  commissionBasisPoints: 500,
  minimumWithdrawalCents: 5000,
  milestoneInterval: 50,
  milestoneValueCents: 7900,
  annualMilestoneCap: 7,
  ambassadorThreshold: 300,
  ambassadorValueCents: 14900,
  timezone: "Africa/Johannesburg",
});

function integer(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
  return value;
}

function basisPoints(value: number): number {
  integer(value, "rate");
  if (value > 10000) throw new Error("Rate exceeds 100%");
  return value;
}

function applyRate(cents: number, rate: number): number {
  integer(cents, "amount");
  basisPoints(rate);
  const product = cents * rate;
  if (!Number.isSafeInteger(product)) throw new Error("Amount exceeds safe range");
  return Math.round(product / 10000);
}

export function subscriptionReferralQuote(input: {
  normalPriceCents: number;
  firstEligiblePayment: boolean;
  discountBasisPoints?: number;
  commissionBasisPoints?: number;
  commissionBasis?: "normal_price" | "paid_price";
}) {
  const normalPriceCents = integer(input.normalPriceCents, "normal price", 1);
  const discountCents = input.firstEligiblePayment
    ? applyRate(normalPriceCents, input.discountBasisPoints ?? REFERRAL_DEFAULTS.discountBasisPoints)
    : 0;
  const payableCents = normalPriceCents - discountCents;
  const commissionBasisCents = input.commissionBasis === "paid_price" ? payableCents : normalPriceCents;
  return {
    normalPriceCents,
    discountCents,
    payableCents,
    commissionBasisCents,
    commissionCents: input.firstEligiblePayment
      ? applyRate(commissionBasisCents, input.commissionBasisPoints ?? REFERRAL_DEFAULTS.commissionBasisPoints)
      : 0,
  };
}

export function qualifiesForCommission(input: {
  confirmed: boolean;
  firstSubscriptionPayment: boolean;
  environment: "test" | "live";
  selfReferral: boolean;
  duplicateIdentity: boolean;
  fraud: boolean;
  refunded: boolean;
  chargedBack: boolean;
  currency: string;
  confirmedAmountCents: number;
  expectedAmountCents: number;
}) {
  return input.confirmed && input.firstSubscriptionPayment && input.environment === "live"
    && !input.selfReferral && !input.duplicateIdentity && !input.fraud
    && !input.refunded && !input.chargedBack && input.currency === "ZAR"
    && Number.isSafeInteger(input.confirmedAmountCents) && input.confirmedAmountCents > 0
    && input.confirmedAmountCents === input.expectedAmountCents;
}

export function businessCalendarYear(timestamp: string | Date, timezone = REFERRAL_DEFAULTS.timezone): number {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp");
  const year = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric" })
    .formatToParts(date).find((part) => part.type === "year")?.value;
  if (!year) throw new Error("Calendar year unavailable");
  return Number(year);
}

export function milestoneCandidates(input: {
  lifetimeSuccessful: number;
  standardThresholdsAlreadyAwarded: readonly number[];
  standardAwardsThisYear: number;
  ambassadorAlreadyAwarded: boolean;
}) {
  integer(input.lifetimeSuccessful, "referral count");
  integer(input.standardAwardsThisYear, "annual awards");
  const awarded = new Set(input.standardThresholdsAlreadyAwarded.map((n) => integer(n, "threshold", 1)));
  const remainingAllowance = Math.max(0, REFERRAL_DEFAULTS.annualMilestoneCap - input.standardAwardsThisYear);
  const standardThresholds: number[] = [];
  for (let threshold = REFERRAL_DEFAULTS.milestoneInterval;
    threshold <= input.lifetimeSuccessful && standardThresholds.length < remainingAllowance;
    threshold += REFERRAL_DEFAULTS.milestoneInterval) {
    if (!awarded.has(threshold)) standardThresholds.push(threshold);
  }
  return {
    standardThresholds,
    standardValueCents: standardThresholds.length * REFERRAL_DEFAULTS.milestoneValueCents,
    ambassadorEligible: input.lifetimeSuccessful >= REFERRAL_DEFAULTS.ambassadorThreshold && !input.ambassadorAlreadyAwarded,
    remainingAllowance,
    nextThreshold: (Math.floor(input.lifetimeSuccessful / REFERRAL_DEFAULTS.milestoneInterval) + 1) * REFERRAL_DEFAULTS.milestoneInterval,
  };
}

export function rewardCreditAmount(valueCents: number, creditsPerRand: number | null): number {
  integer(valueCents, "reward value", 1);
  if (creditsPerRand === null || !Number.isFinite(creditsPerRand) || creditsPerRand <= 0) {
    throw new Error("Administrator-confirmed credit conversion required");
  }
  const credits = valueCents * creditsPerRand / 100;
  if (!Number.isSafeInteger(credits) || credits <= 0) {
    throw new Error("Conversion must produce a whole positive credit amount");
  }
  return credits;
}

export function validateWithdrawal(availableCents: number, requestedCents: number): void {
  integer(availableCents, "available balance");
  integer(requestedCents, "withdrawal", REFERRAL_DEFAULTS.minimumWithdrawalCents);
  if (requestedCents > availableCents) throw new Error("Insufficient available commission");
}

export function reserveForecast(input: {
  attributedUsedCostCents: number;
  outstandingCredits: number;
  expectedUsageBasisPoints: number;
  estimatedCostPerUsedCreditCents: number;
  pendingJobCostCents: number;
  safetyMarginBasisPoints: number;
  fundedReserveCents: number;
  providerReportedExpenditureCents: number | null;
  monthlyBudgetCents: number | null;
}) {
  for (const [name, value] of Object.entries(input)) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid ${name}`);
  }
  basisPoints(input.expectedUsageBasisPoints);
  integer(input.safetyMarginBasisPoints, "safety margin");
  const futureCostCents = Math.ceil(input.outstandingCredits * input.expectedUsageBasisPoints / 10000 * input.estimatedCostPerUsedCreditCents);
  const requiredCents = Math.ceil((input.attributedUsedCostCents + futureCostCents + input.pendingJobCostCents)
    * (1 + input.safetyMarginBasisPoints / 10000));
  const availableReserveCents = input.fundedReserveCents - input.attributedUsedCostCents;
  return {
    futureCostCents,
    estimatedRequiredCents: requiredCents,
    availableReserveCents,
    shortfallCents: Math.max(0, requiredCents - input.fundedReserveCents),
    budgetReached: input.monthlyBudgetCents !== null && input.providerReportedExpenditureCents !== null
      ? input.providerReportedExpenditureCents >= input.monthlyBudgetCents : null,
    providerUsageReconciled: input.providerReportedExpenditureCents !== null,
  };
}