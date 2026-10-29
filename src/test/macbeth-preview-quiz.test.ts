import { describe, expect, it } from "vitest";
import { macbethPreviewQuiz, scoreMacbethPreview } from "@/lib/macbeth-preview";

describe("public Macbeth quiz", () => {
  it("limits the free preview to five questions", () => {
    expect(macbethPreviewQuiz.length).toBeGreaterThan(0);
    expect(macbethPreviewQuiz.length).toBeLessThanOrEqual(5);
  });

  it("scores the five correct Act I answers", () => {
    expect(scoreMacbethPreview([0, 2, 1, 3, 2])).toBe(5);
  });

  it("does not credit incorrect or unanswered questions", () => {
    expect(scoreMacbethPreview([1, 0, null, 3, 0])).toBe(1);
    expect(scoreMacbethPreview([])).toBe(0);
  });
});