"use client";

import { useCallback, useState } from "react";
import type { Studio } from "@/db/schema";
import MomencePicker from "./MomencePicker";
import { Avatar, EmptyState, Panel } from "./ui";
import { useEscape } from "@/lib/use-escape";
import { apiFetch, apiPost, ApiError } from "@/lib/api-client";

type Member = { id: number; firstName?: string; lastName?: string; email?: string | null; phoneNumber?: string | null; visits?: { total?: number } };
type Membership = {
  id: number;
  type: string;
  isFrozen: boolean;
  eventCreditsLeft: number | null;
  eventCreditsTotal: number | null;
  endDate: string | null;
  membership: { id: number; name: string } | null;
};
type Booking = {
  id: number;
  checkedIn: boolean;
  cancelledAt: string | null;
  session: { id: number; name: string; startsAt: string; teacher: { firstName: string; lastName: string } | null; inPersonLocation: { name: string } | null } | null;
};
type Attendee = { bookingId: number; memberId: number; name: string; email: string | null; checkedIn: boolean; cancelled: boolean };

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "2-digit", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

export default function MomenceConsole({ studios }: { studios: Studio[] }) {
  const [tab, setTab] = useState<"member" | "session">("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const [member, setMember] = useState<Member | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  const [session, setSession] = useState<{ id: number; name: string; startsAt: string; teacher: string | null; location: string | null } | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [addMemberFor, setAddMemberFor] = useState<"free" | "waitlist" | null>(null);
  const [freezeFor, setFreezeFor] = useState<Membership | null>(null);
  const [freezeAt, setFreezeAt] = useState("");
  const [unfreezeAt, setUnfreezeAt] = useState("");
  const [creditsFor, setCreditsFor] = useState<Membership | null>(null);
  const [creditValue, setCreditValue] = useState("0");

  useEscape(!!addMemberFor, () => setAddMemberFor(null));
  useEscape(!!freezeFor, () => setFreezeFor(null));
  useEscape(!!creditsFor, () => setCreditsFor(null));

  const flash = (text: string, ok: boolean) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4200);
  };

  const act = useCallback(async (payload: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const data = await apiPost<{ ok?: boolean; error?: string }>("/api/momence/actions", payload);
      flash(data.ok ? `${label} — done.` : data.error ?? `${label} failed.`, !!data.ok);
      return !!data.ok;
    } catch (err) {
      flash(err instanceof ApiError ? err.message : `${label} failed — network error.`, false);
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  const load360 = useCallback(async (memberId: number) => {
    setBusy("Loading member");
    try {
      const d = await apiPost<{ member?: Member; memberships?: Membership[]; bookings?: Booking[] }>(
        "/api/momence/actions",
        { action: "member-360", memberId },
      );
      setMember(d.member ?? null);
      setMemberships(d.memberships ?? []);
      setBookings(d.bookings ?? []);
    } finally {
      setBusy(null);
    }
  }, []);

  const loadAttendees = useCallback(async (sessionId: number) => {
    setBusy("Loading roster");
    try {
      const d = await apiFetch<{ attendees?: Attendee[] }>(`/api/momence?resource=attendees&sessionId=${sessionId}`);
      setAttendees(d.attendees ?? []);
    } finally {
      setBusy(null);
    }
  }, []);

  const memberName = member ? `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() : "";

  return (
    <div className="space-y-4">
      {toast && (
        <div
          className="animate-pop fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-4 py-2.5 text-[12.5px] font-medium"
          style={{
            background: toast.ok ? "var(--mint)" : "var(--danger)",
            color: "#fff",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {toast.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          <button data-active={tab === "member"} onClick={() => setTab("member")}>Member operations</button>
          <button data-active={tab === "session"} onClick={() => setTab("session")}>Class operations</button>
        </div>
        {busy && <span className="chip accent-soft">{busy}…</span>}
      </div>

      {tab === "member" && (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Panel title="Find a member" subtitle="Live Momence directory">
            <MomencePicker
              kind="member"
              studios={studios}
              autoFocus={false}
              compact
              onPick={(r) => {
                const id = Number(r.meta?.memberId ?? 0);
                if (id) void load360(id);
              }}
            />
          </Panel>

          {!member ? (
            <Panel title="Member 360" subtitle="Profile, packages and bookings" padded={false}>
              <EmptyState icon="◍" title="No member selected" body="Search on the left to pull a complete Momence profile." />
            </Panel>
          ) : (
            <div className="space-y-4">
              <div className="panel rounded-2xl p-5">
                <div className="flex flex-wrap items-center gap-4">
                  <Avatar name={memberName} size={54} />
                  <div className="min-w-0 flex-1">
                    <h2 className="serif text-[24px] leading-none txt">{memberName || `Member ${member.id}`}</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="chip chip-line">ID {member.id}</span>
                      {member.email && <span className="chip chip-line">{member.email}</span>}
                      {member.phoneNumber && <span className="chip chip-line">{member.phoneNumber}</span>}
                      <span className="chip accent-soft">{member.visits?.total ?? 0} visits</span>
                    </div>
                  </div>
                </div>
              </div>

              <Panel title="Active memberships" subtitle={`${memberships.length} on file`} padded={false}>
                {memberships.length === 0 ? (
                  <EmptyState icon="◇" title="No active packages" body="This member has nothing live right now." />
                ) : (
                  <div className="divide-y hairline">
                    {memberships.map((m) => (
                      <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium txt">{m.membership?.name ?? m.type}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1.5">
                            <span className="chip chip-line">{m.type}</span>
                            {m.eventCreditsLeft != null && (
                              <span className="chip accent-soft">{m.eventCreditsLeft}/{m.eventCreditsTotal ?? "—"} credits</span>
                            )}
                            {m.endDate && <span className="chip chip-line">ends {fmt(m.endDate)}</span>}
                            {m.isFrozen && <span className="chip warn-soft">frozen</span>}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {m.isFrozen ? (
                            <button
                              className="btn btn-mint !py-1.5 !text-[11.5px]"
                              disabled={!!busy}
                              onClick={async () => {
                                if (await act({ action: "unfreeze", memberId: member.id, boughtMembershipId: m.id }, "Unfreeze"))
                                  void load360(member.id);
                              }}
                            >
                              Unfreeze
                            </button>
                          ) : (
                            <button className="btn btn-ghost !py-1.5 !text-[11.5px]" onClick={() => setFreezeFor(m)}>
                              Freeze
                            </button>
                          )}
                          {m.eventCreditsLeft != null && (
                            <button
                              className="btn btn-ghost !py-1.5 !text-[11.5px]"
                              onClick={() => {
                                setCreditsFor(m);
                                setCreditValue(String(m.eventCreditsLeft ?? 0));
                              }}
                            >
                              Credits
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Recent bookings" subtitle={`${bookings.length} sessions`} padded={false}>
                {bookings.length === 0 ? (
                  <EmptyState icon="◷" title="No bookings" body="Nothing on this member's history." />
                ) : (
                  <div className="divide-y hairline">
                    {bookings.map((b) => (
                      <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium txt">{b.session?.name ?? "Session"}</div>
                          <div className="text-[10.5px] txt-3">
                            {fmt(b.session?.startsAt)}
                            {b.session?.teacher ? ` · ${b.session.teacher.firstName} ${b.session.teacher.lastName}` : ""}
                            {b.session?.inPersonLocation ? ` · ${b.session.inPersonLocation.name}` : ""}
                          </div>
                        </div>
                        {b.cancelledAt ? (
                          <span className="chip danger-soft">cancelled</span>
                        ) : (
                          <>
                            <span className={`chip ${b.checkedIn ? "mint-soft" : "chip-line"}`}>
                              {b.checkedIn ? "checked in" : "booked"}
                            </span>
                            <button
                              className="btn btn-ghost !py-1 !text-[11px]"
                              disabled={!!busy}
                              onClick={async () => {
                                if (await act({ action: b.checkedIn ? "check-out" : "check-in", bookingId: b.id }, b.checkedIn ? "Check out" : "Check in"))
                                  void load360(member.id);
                              }}
                            >
                              {b.checkedIn ? "Undo check-in" : "Check in"}
                            </button>
                            <button
                              className="btn btn-ghost !py-1 !text-[11px]"
                              style={{ color: "var(--danger)" }}
                              disabled={!!busy}
                              onClick={async () => {
                                if (await act({ action: "cancel-booking", bookingId: b.id, refund: true, notify: true }, "Cancel booking"))
                                  void load360(member.id);
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      )}

      {tab === "session" && (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Panel title="Find a class" subtitle="Recent & upcoming sessions">
            <MomencePicker
              kind="session"
              studios={studios}
              autoFocus={false}
              compact
              onPick={(r) => {
                const id = Number(r.meta?.sessionId ?? 0);
                if (!id) return;
                setSession({
                  id,
                  name: String(r.meta?.sessionName ?? r.label),
                  startsAt: String(r.meta?.startsAt ?? ""),
                  teacher: (r.meta?.teacher as string) ?? null,
                  location: (r.meta?.location as string) ?? null,
                });
                void loadAttendees(id);
              }}
            />
          </Panel>

          {!session ? (
            <Panel title="Class roster" subtitle="Attendance & booking control" padded={false}>
              <EmptyState icon="◷" title="No class selected" body="Search on the left to load its roster." />
            </Panel>
          ) : (
            <div className="space-y-4">
              <div className="panel rounded-2xl p-5">
                <h2 className="serif text-[24px] leading-none txt">{session.name}</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="chip chip-line">{fmt(session.startsAt)}</span>
                  {session.teacher && <span className="chip accent-soft">{session.teacher}</span>}
                  {session.location && <span className="chip chip-line">{session.location}</span>}
                  <span className="chip chip-line">{attendees.filter((a) => !a.cancelled).length} booked</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button className="btn btn-primary !py-1.5 !text-[11.5px]" onClick={() => setAddMemberFor("free")}>
                    Add member free
                  </button>
                  <button className="btn btn-ghost !py-1.5 !text-[11.5px]" onClick={() => setAddMemberFor("waitlist")}>
                    Add to waitlist
                  </button>
                  <button className="btn btn-ghost !py-1.5 !text-[11.5px]" onClick={() => void loadAttendees(session.id)}>
                    Refresh roster
                  </button>
                </div>
              </div>

              <Panel title="Roster" subtitle={`${attendees.length} bookings`} padded={false}>
                {attendees.length === 0 ? (
                  <EmptyState icon="◍" title="Nobody booked" body="This session has no bookings yet." />
                ) : (
                  <div className="divide-y hairline">
                    {attendees.map((a) => (
                      <div key={a.bookingId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                        <Avatar name={a.name} size={26} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium txt">{a.name}</div>
                          {a.email && <div className="truncate text-[10.5px] txt-3">{a.email}</div>}
                        </div>
                        {a.cancelled ? (
                          <span className="chip danger-soft">cancelled</span>
                        ) : (
                          <>
                            <span className={`chip ${a.checkedIn ? "mint-soft" : "chip-line"}`}>
                              {a.checkedIn ? "checked in" : "booked"}
                            </span>
                            <button
                              className="btn btn-ghost !py-1 !text-[11px]"
                              disabled={!!busy}
                              onClick={async () => {
                                if (await act({ action: a.checkedIn ? "check-out" : "check-in", bookingId: a.bookingId }, a.checkedIn ? "Check out" : "Check in"))
                                  void loadAttendees(session.id);
                              }}
                            >
                              {a.checkedIn ? "Undo" : "Check in"}
                            </button>
                            <button
                              className="btn btn-ghost !py-1 !text-[11px]"
                              style={{ color: "var(--danger)" }}
                              disabled={!!busy}
                              onClick={async () => {
                                if (await act({ action: "cancel-booking", bookingId: a.bookingId, refund: true, notify: true }, "Cancel booking"))
                                  void loadAttendees(session.id);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn btn-ghost !py-1 !text-[11px]"
                              onClick={() => void load360(a.memberId).then(() => setTab("member"))}
                            >
                              Profile
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      )}

      {/* add member modal */}
      {addMemberFor && session && (
        <Modal title={addMemberFor === "free" ? "Add member for free" : "Add to waitlist"} onClose={() => setAddMemberFor(null)}>
          <MomencePicker
            kind="member"
            studios={studios}
            onPick={async (r) => {
              const id = Number(r.meta?.memberId ?? 0);
              if (!id) return;
              const ok = await act(
                { action: addMemberFor === "free" ? "add-free" : "add-waitlist", sessionId: session.id, memberId: id },
                addMemberFor === "free" ? "Add member free" : "Add to waitlist",
              );
              setAddMemberFor(null);
              if (ok) void loadAttendees(session.id);
            }}
          />
        </Modal>
      )}

      {/* freeze modal */}
      {freezeFor && member && (
        <Modal title="Freeze membership" onClose={() => setFreezeFor(null)}>
          <p className="mb-3 text-[12px] txt-3">
            {freezeFor.membership?.name ?? freezeFor.type} for {memberName}. Leave the start blank to freeze immediately.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium txt-2">Freeze from</label>
              <input type="date" className="field" value={freezeAt} onChange={(e) => setFreezeAt(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium txt-2">Auto-unfreeze on</label>
              <input type="date" className="field" value={unfreezeAt} onChange={(e) => setUnfreezeAt(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setFreezeFor(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!!busy}
              onClick={async () => {
                const ok = await act(
                  {
                    action: "freeze",
                    memberId: member.id,
                    boughtMembershipId: freezeFor.id,
                    freezeAt: freezeAt ? new Date(freezeAt).toISOString() : undefined,
                    unfreezeAt: unfreezeAt ? new Date(unfreezeAt).toISOString() : undefined,
                  },
                  "Freeze membership",
                );
                setFreezeFor(null);
                if (ok) void load360(member.id);
              }}
            >
              Apply freeze
            </button>
          </div>
        </Modal>
      )}

      {/* credits modal */}
      {creditsFor && member && (
        <Modal title="Adjust class credits" onClose={() => setCreditsFor(null)}>
          <p className="mb-3 text-[12px] txt-3">
            {creditsFor.membership?.name ?? creditsFor.type} — currently {creditsFor.eventCreditsLeft} credit(s).
          </p>
          <input type="number" className="field" value={creditValue} onChange={(e) => setCreditValue(e.target.value)} />
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setCreditsFor(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={!!busy}
              onClick={async () => {
                const ok = await act(
                  { action: "update-credits", memberId: member.id, boughtMembershipId: creditsFor.id, credits: Number(creditValue) },
                  "Update credits",
                );
                setCreditsFor(null);
                if (ok) void load360(member.id);
              }}
            >
              Save credits
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEscape(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--page) 68%, transparent)" }} onClick={onClose} aria-label="Close" />
      <div className="panel animate-pop relative z-10 w-full max-w-[460px] rounded-3xl p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="serif text-[20px] leading-none txt">{title}</h3>
          <button onClick={onClose} className="btn btn-ghost ml-auto !px-2 !py-1">×</button>
        </div>
        {children}
        <p className="mt-3 text-[10px] uppercase tracking-[0.16em] txt-3">Press Esc to close</p>
      </div>
    </div>
  );
}
