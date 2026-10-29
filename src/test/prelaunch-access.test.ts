import { describe, expect, it } from "vitest";
import { prelaunchDecision } from "../../supabase/functions/_shared/prelaunch-policy";

describe("administrator-only prelaunch authorization", () => {
  it("allows a server-verified administrator", () => expect(prelaunchDecision("admin")).toBeNull());
  it("denies existing non-admin accounts, including flagged learners", () => expect(prelaunchDecision("learner")).toBe(403));
  it("denies anonymous access", () => expect(prelaunchDecision("anonymous")).toBe(401));
  it("denies access when verification fails", () => expect(prelaunchDecision("error")).toBe(403));
  it("preserves trusted internal processing", () => expect(prelaunchDecision("internal")).toBeNull());
});