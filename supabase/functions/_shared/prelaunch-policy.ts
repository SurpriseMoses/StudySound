// Authorization outcomes only; identities and roles must be checked by the server.
export function prelaunchDecision(identity: "admin" | "learner" | "anonymous" | "internal" | "error"): number | null {
  if (identity === "admin" || identity === "internal") return null;
  return identity === "anonymous" ? 401 : 403;
}