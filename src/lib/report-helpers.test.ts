import { describe, expect, it } from "vitest";
import { ageHours, breached, isClosed, isOpen, pct } from "./report-helpers";
import type { Ticket } from "@/db/schema";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    status: "Open",
    slaDueAt: null,
    resolvedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as Ticket;
}

describe("isOpen / isClosed", () => {
  it("treats Open, In Progress, Awaiting Info as open", () => {
    expect(isOpen(makeTicket({ status: "Open" }))).toBe(true);
    expect(isOpen(makeTicket({ status: "In Progress" }))).toBe(true);
    expect(isOpen(makeTicket({ status: "Resolved" }))).toBe(false);
  });

  it("treats Resolved and Closed as closed", () => {
    expect(isClosed(makeTicket({ status: "Resolved" }))).toBe(true);
    expect(isClosed(makeTicket({ status: "Closed" }))).toBe(true);
    expect(isClosed(makeTicket({ status: "Open" }))).toBe(false);
  });
});

describe("breached", () => {
  it("is false when there is no SLA due date", () => {
    expect(breached(makeTicket({ slaDueAt: null }))).toBe(false);
  });

  it("is true for an open ticket past its SLA due date", () => {
    const past = new Date(Date.now() - 60_000);
    expect(breached(makeTicket({ status: "Open", slaDueAt: past }))).toBe(true);
  });

  it("is false for an open ticket still within its SLA window", () => {
    const future = new Date(Date.now() + 60_000);
    expect(breached(makeTicket({ status: "Open", slaDueAt: future }))).toBe(false);
  });

  it("checks a closed ticket against when it was actually resolved", () => {
    const due = new Date("2026-01-01T00:00:00Z");
    const resolvedLate = new Date("2026-01-02T00:00:00Z");
    const resolvedOnTime = new Date("2025-12-31T00:00:00Z");
    expect(breached(makeTicket({ status: "Resolved", slaDueAt: due, resolvedAt: resolvedLate }))).toBe(true);
    expect(breached(makeTicket({ status: "Resolved", slaDueAt: due, resolvedAt: resolvedOnTime }))).toBe(false);
  });
});

describe("pct", () => {
  it("returns 0 when the denominator is 0", () => {
    expect(pct(5, 0)).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    expect(pct(1, 3)).toBe(33);
  });
});

describe("ageHours", () => {
  it("measures elapsed hours from creation to resolution", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const resolvedAt = new Date("2026-01-01T05:00:00Z");
    expect(ageHours(makeTicket({ createdAt, resolvedAt }))).toBe(5);
  });
});
