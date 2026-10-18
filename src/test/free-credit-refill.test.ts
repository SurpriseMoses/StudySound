import { describe, it, expect } from "vitest";
import { weeklyFreeRefill } from "../../supabase/functions/_shared/credit-source-rules";

describe("weekly free credit refill", () => {
  it("keeps purchased credits when free credits expire", () => {
    expect(weeklyFreeRefill(60, 20).balance).toBe(60); // 40 bought + 20 fresh
  });
  it("keeps reward credits even after free ones were spent", () => {
    expect(weeklyFreeRefill(79, 0).balance).toBe(99);
  });
  it("refills a free-only wallet to 20", () => {
    expect(weeklyFreeRefill(5, 5).balance).toBe(20);
  });
});
