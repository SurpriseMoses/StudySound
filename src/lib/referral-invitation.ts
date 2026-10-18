import { z } from "zod";

export const invitationStorageKey = "braingrasp.referral-invitation";
export const referralCodeSchema = z.string().regex(/^[a-f0-9]{32}$/);
const invitationSchema = z.object({
  code: referralCodeSchema,
  token: z.string().uuid(),
  expires_at: z.string().datetime({ offset: true }),
});
export type ReferralInvitation = z.infer<typeof invitationSchema>;

export function parseInvitation(raw: string | null, now = Date.now()): ReferralInvitation | null {
  if (!raw) return null;
  try {
    const parsed = invitationSchema.safeParse(JSON.parse(raw));
    return parsed.success && Date.parse(parsed.data.expires_at) > now ? parsed.data : null;
  } catch { return null; }
}

export function readInvitation(): ReferralInvitation | null {
  try { return parseInvitation(localStorage.getItem(invitationStorageKey)); }
  catch { return null; }
}

export function saveInvitation(value: unknown): boolean {
  const parsed = parseInvitation(JSON.stringify(value));
  if (!parsed) return false;
  try { localStorage.setItem(invitationStorageKey, JSON.stringify(parsed)); return true; }
  catch { return false; }
}

export function clearInvitation(token: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(invitationStorageKey) ?? "null");
    if (saved?.token === token) localStorage.removeItem(invitationStorageKey);
  } catch { /* unavailable storage must not prevent authentication */ }
}

export function shouldRetryBinding(status: string): boolean {
  return status === "profile_pending" || status === "verification_pending";
}