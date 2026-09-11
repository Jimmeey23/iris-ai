import { beforeEach, expect, it, vi } from "vitest";

/**
 * The "Raised before" panel must be explainable: an owner reading two tickets
 * side by side needs the reason they were matched, not a similarity score.
 */
const rows: Record<string, unknown>[] = [];
const select = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          select(...args);
          return {
            limit: async () => rows.filter((r) => r.__subject),
            orderBy: () => ({ limit: async () => rows }),
          };
        },
      }),
    }),
  },
}));

const { findSimilarTickets } = await import("./recurrence");

function ticket(patch: Record<string, unknown>) {
  return {
    id: 2, ticketNumber: "IRIS-0002", title: "Mic dead in Studio 2", summary: "The handheld mic has no power.",
    rootCause: null, category: "Repair and Maintenance", subcategory: "Equipment Fault", status: "Resolved",
    priority: "Medium", assigneeName: "Ops", studioId: 1, studioName: "Kemps Corner", location: "Studio 2",
    systemAffected: "Audio / mic system", momenceMemberId: null, memberName: null, trainerName: null,
    createdAt: new Date("2026-08-01"), resolvedAt: new Date("2026-08-02"), ...patch,
  };
}

beforeEach(() => {
  rows.length = 0;
  rows.push(ticket({ id: 1, ticketNumber: "IRIS-0001", __subject: true, createdAt: new Date("2026-09-01"), resolvedAt: null, status: "Open" }));
});

it("matches an earlier ticket on studio, issue type and the thing that broke", async () => {
  rows.push(ticket({}));
  const [hit] = await findSimilarTickets(1);
  expect(hit.ticketNumber).toBe("IRIS-0002");
  expect(hit.reasons).toContain("Same studio — Kemps Corner");
  expect(hit.reasons.some((r) => r.includes("mic"))).toBe(true);
  expect(hit.resolvedAt).toBe("2026-08-02");
});

it("never returns the ticket being viewed", async () => {
  expect(await findSimilarTickets(1)).toEqual([]);
});

it("does not call two unrelated faults in the same category a recurrence", async () => {
  rows.push(
    ticket({
      id: 3, ticketNumber: "IRIS-0003", title: "Ceiling leak in the lobby", summary: "Water dripping near reception.",
      subcategory: "Plumbing", studioId: 2, studioName: "Bandra", location: "Lobby", systemAffected: null,
    }),
  );
  expect(await findSimilarTickets(1)).toEqual([]);
});
