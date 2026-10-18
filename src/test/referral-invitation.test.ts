import { describe, expect, it } from "vitest";
import { parseInvitation, referralCodeSchema, shouldRetryBinding } from "@/lib/referral-invitation";

const invitation = { code: "a".repeat(32), token: "11111111-1111-4111-8111-111111111111", expires_at: "2026-11-17T17:00:00Z" };
describe("invitation convenience storage is not eligibility", () => {
  it("retains the server's 30-day expiry without extending it on reload", () => {
    const now = Date.parse("2026-10-18T17:00:00Z");
    expect(Date.parse(invitation.expires_at) - now).toBe(30 * 86400000);
    expect(parseInvitation(JSON.stringify(invitation), now)).toEqual(invitation);
    expect(parseInvitation(JSON.stringify(invitation), Date.parse(invitation.expires_at))).toBeNull();
  });
  it("rejects malformed claims and private identifiers as codes", () => {
    expect(referralCodeSchema.safeParse("learner@example.com").success).toBe(false);
    expect(parseInvitation(JSON.stringify({ ...invitation, token: "fake" }), 0)).toBeNull();
    expect(parseInvitation("not json", 0)).toBeNull();
  });
  it("retries readiness only, not rejected or disabled attribution", () => {
    expect(shouldRetryBinding("verification_pending")).toBe(true);
    expect(shouldRetryBinding("profile_pending")).toBe(true);
    for (const status of ["attributed", "already_attributed", "disabled", "existing_account", "ineligible", "expired_or_used"]) expect(shouldRetryBinding(status)).toBe(false);
  });
});