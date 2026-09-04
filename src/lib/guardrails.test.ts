import { describe, expect, it } from "vitest";
import { enforcePriority, enforceUrgency, priorityFloor, resolveClassification } from "./guardrails";
import { TAXONOMY } from "./taxonomy";

describe("priority floor", () => {
  it("treats injury as critical", () => {
    expect(priorityFloor("member fell and hurt her wrist").floor).toBe("Critical");
  });

  it("treats a power cut as high", () => {
    expect(priorityFloor("there was no electricity for an hour, power cut").floor).toBe("High");
  });

  it("leaves ordinary reports alone", () => {
    expect(priorityFloor("would be nice to have charging points").floor).toBe("Low");
  });

  it("never lets the model downgrade a safety report", () => {
    const { priority } = enforcePriority("Low", "a member fainted during class");
    expect(priority).toBe("Critical");
  });

  it("keeps the model's own call when it is above the floor", () => {
    const { priority } = enforcePriority("High", "the lounge sofa is stained");
    expect(priority).toBe("High");
  });

  it("defaults an unusable priority to Medium", () => {
    const { priority } = enforcePriority(undefined, "the lounge sofa is stained");
    expect(priority).toBe("Medium");
  });
});

describe("urgency banding", () => {
  it("keeps urgency inside the band for its priority", () => {
    expect(enforceUrgency(20, "Critical")).toBeGreaterThanOrEqual(85);
    expect(enforceUrgency(99, "Low")).toBeLessThanOrEqual(45);
  });

  it("passes through a sensible score untouched", () => {
    expect(enforceUrgency(70, "High")).toBe(70);
  });
});

describe("classification guardrail", () => {
  it("accepts a valid pair verbatim", () => {
    const sub = TAXONOMY["Repair and Maintenance"][0];
    const r = resolveClassification("Repair and Maintenance", sub, "anything");
    expect(r).toMatchObject({ category: "Repair and Maintenance", subcategory: sub, corrected: false });
  });

  it("repairs an invented subcategory within a real category", () => {
    const r = resolveClassification("Repair and Maintenance", "Total Nonsense", "the ac is not cooling");
    expect(r.corrected).toBe(true);
    expect(TAXONOMY["Repair and Maintenance"]).toContain(r.subcategory);
  });

  it("falls back to the on-device classifier for an invented category", () => {
    const r = resolveClassification("Made Up Category", "Also Fake", "the shower has no hot water");
    expect(r.corrected).toBe(true);
    expect(TAXONOMY[r.category]).toContain(r.subcategory);
  });
});

describe("money signals", () => {
  it("treats a duplicate charge as at least High", () => {
    expect(priorityFloor("she was charged twice for her class pack").floor).toBe("High");
  });

  it("treats a refund demand as at least High", () => {
    expect(priorityFloor("the member wants a refund today").floor).toBe("High");
  });
});
