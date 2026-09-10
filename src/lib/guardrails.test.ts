import { describe, expect, it } from "vitest";
import { enforcePriority, enforceUrgency, normaliseRaisedFor, priorityFloor, resolveClassification } from "./guardrails";
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

  it("treats a chargeback as at least High", () => {
    expect(priorityFloor("the member filed a chargeback with her bank").floor).toBe("High");
  });
});

describe("floor diet — judgement words belong to the model", () => {
  it("does not escalate a member threatening to cancel", () => {
    expect(priorityFloor("the member threatened to cancel her membership").floor).toBe("Low");
  });

  it("does not escalate polite refund requests", () => {
    expect(priorityFloor("the member asked for a refund for the missed class").floor).toBe("Low");
  });
});

describe("raised-for normalisation", () => {
  it("maps near-miss model wording onto the four canonical values", () => {
    expect(normaliseRaisedFor("on behalf of a member")).toBe("On behalf of a member");
    expect(normaliseRaisedFor("Several members complained")).toBe("Multiple members");
    expect(normaliseRaisedFor("I noticed it during close")).toBe("Noticed by staff");
    expect(normaliseRaisedFor("staff or trainer concern")).toBe("Staff or trainer concern");
    expect(normaliseRaisedFor("a member reported this")).toBe("On behalf of a member");
  });

  it("defaults empty or unusable values", () => {
    expect(normaliseRaisedFor(undefined)).toBe("Noticed by staff");
    expect(normaliseRaisedFor("")).toBe("Noticed by staff");
    expect(normaliseRaisedFor("the moon")).toBe("Noticed by staff");
  });
});
