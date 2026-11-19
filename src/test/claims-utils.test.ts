import { describe, it, expect } from "vitest";
import {
  WORKFLOW_STAGES,
  stageStep,
  stageLabel,
  agingBucket,
  agingColor,
  SUB_CATEGORIES,
} from "@/components/admin/claims/claims-utils";

describe("Claims Module Utilities", () => {
  it("resolves sequential workflow steps correctly", () => {
    expect(stageStep("intimated")).toBe(1);
    expect(stageStep("documents_pending")).toBe(2);
    expect(stageStep("surveyor_assigned")).toBe(4);
    expect(stageStep("approved")).toBe(8);
    expect(stageStep("settled")).toBe(10);
    expect(stageStep("rejected")).toBe(0);
    expect(stageStep("closed")).toBe(0);
    expect(stageStep("unknown_status")).toBe(1); // fallback
  });

  it("resolves human-readable labels for claim stages", () => {
    expect(stageLabel("intimated")).toBe("Claim Intimated");
    expect(stageLabel("under_assessment")).toBe("Under Assessment");
    expect(stageLabel("payment_processing")).toBe("Payment Processing");
    expect(stageLabel("settled")).toBe("Settled");
  });

  it("calculates claim aging buckets accurately", () => {
    const now = Date.now();
    const day = 86400000;

    const d3 = new Date(now - 3 * day).toISOString();
    const d10 = new Date(now - 10 * day).toISOString();
    const d25 = new Date(now - 25 * day).toISOString();
    const d45 = new Date(now - 45 * day).toISOString();
    const d90 = new Date(now - 90 * day).toISOString();

    expect(agingBucket(d3)).toBe("0-7 Days");
    expect(agingBucket(d10)).toBe("8-15 Days");
    expect(agingBucket(d25)).toBe("16-30 Days");
    expect(agingBucket(d45)).toBe("31-60 Days");
    expect(agingBucket(d90)).toBe("60+ Days");
    expect(agingBucket(null)).toBe("—");
  });

  it("returns appropriate badge styling based on aging severity", () => {
    expect(agingColor("0-7 Days")).toContain("green");
    expect(agingColor("8-15 Days")).toContain("blue");
    expect(agingColor("16-30 Days")).toContain("amber");
    expect(agingColor("31-60 Days")).toContain("orange");
    expect(agingColor("60+ Days")).toContain("red");
    expect(agingColor("unknown")).toContain("muted");
  });

  it("supports all major policy subcategories", () => {
    expect(SUB_CATEGORIES.motor).toContain("Own Damage");
    expect(SUB_CATEGORIES.motor).toContain("Third Party");
    expect(SUB_CATEGORIES.health).toContain("Cashless");
    expect(SUB_CATEGORIES.health).toContain("Reimbursement");
    expect(SUB_CATEGORIES.life).toContain("Death Claim");
  });
});
