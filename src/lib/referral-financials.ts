import type { WithdrawalStatus } from "../../supabase/functions/_shared/referral-rules";

export type Withdrawal = { id: string; amount_cents: number; status: WithdrawalStatus; requested_at: string; updated_at: string };
export type Financials = {
  available_cents: number; pending_cents: number; reserved_cents: number; paid_cents: number; reversed_cents: number; recovery_cents: number;
  withdrawals_enabled: boolean; minimum_cents: number; withdrawals: Withdrawal[];
};
export const commissionMoney = (cents: number) => `R${(Number(cents) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function parseWithdrawalCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2147483647 ? cents : null;
}