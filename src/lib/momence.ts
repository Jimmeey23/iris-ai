import { getSetting } from "./settings";

const BASE = "https://api.momence.com/api/v2";

type TokenCache = { token: string; expiresAt: number; hostId: number };
const globalForMomence = globalThis as typeof globalThis & {
  __momenceToken?: TokenCache;
};

export type MomenceCreds = {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

export async function getCreds(): Promise<MomenceCreds | null> {
  const clientId = (await getSetting("momence_client_id")) || process.env.MOMENCE_CLIENT_ID || "";
  const clientSecret =
    (await getSetting("momence_client_secret")) || process.env.MOMENCE_CLIENT_SECRET || "";
  const username = (await getSetting("momence_username")) || process.env.MOMENCE_USERNAME || "";
  const password = (await getSetting("momence_password")) || process.env.MOMENCE_PASSWORD || "";
  if (!clientId || !clientSecret || !username || !password) return null;
  return { clientId, clientSecret, username, password };
}

export async function getAccessToken(force = false): Promise<{ token: string; hostId: number } | null> {
  const cached = globalForMomence.__momenceToken;
  if (!force && cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, hostId: cached.hostId };
  }
  const creds = await getCreds();
  if (!creds) return null;

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "password",
    username: creds.username,
    password: creds.password,
  });

  const res = await fetch(`${BASE}/auth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { accessToken?: string; client?: { hostId?: number } };
  if (!json.accessToken) return null;

  const cache: TokenCache = {
    token: json.accessToken,
    hostId: json.client?.hostId ?? 13752,
    expiresAt: Date.now() + 45 * 60 * 1000,
  };
  globalForMomence.__momenceToken = cache;
  return { token: cache.token, hostId: cache.hostId };
}

async function apiGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T | null> {
  const auth = await getAccessToken();
  if (!auth) return null;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const joiner = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${search.toString() ? `${joiner}${search}` : ""}`;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.token}` },
    cache: "no-store",
  });
  if (res.status === 401) {
    const retry = await getAccessToken(true);
    if (!retry) return null;
    res = await fetch(url, { headers: { Authorization: `Bearer ${retry.token}` }, cache: "no-store" });
  }
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type MomenceMember = {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phoneNumber: string | null;
  pictureUrl: string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  visits?: { total?: number; totalVisits?: number; bookings?: number };
  customerTags?: { id: number; name: string }[];
};

export type MomenceSession = {
  id: number;
  name: string;
  type: string;
  startsAt: string;
  endsAt: string;
  durationInMinutes: number;
  capacity: number | null;
  bookingCount: number | null;
  isCancelled?: boolean;
  teacher: { id: number; firstName: string; lastName: string; pictureUrl: string | null } | null;
  inPersonLocation: { id: number; name: string } | null;
};

export type MomenceMembership = {
  id: number;
  type: string;
  startDate: string | null;
  endDate: string | null;
  isFrozen: boolean;
  eventCreditsLeft: number | null;
  eventCreditsTotal: number | null;
  membership: { id: number; name: string; type: string } | null;
};

export type MemberBooking = {
  id: number;
  checkedIn: boolean;
  cancelledAt: string | null;
  session: MomenceSession | null;
};

type Paginated<T> = { payload: T[]; totalCount?: number };

/* ------------------------------------------------------------------ */
/* Public helpers                                                      */
/* ------------------------------------------------------------------ */

export async function searchMembers(query: string, pageSize = 8): Promise<MomenceMember[]> {
  const data = await apiGet<Paginated<MomenceMember>>("/host/members", {
    page: 0,
    pageSize,
    query: query || undefined,
    sortBy: "lastSeenAt",
    sortOrder: "DESC",
  });
  return data?.payload ?? [];
}

export async function getMember(memberId: number): Promise<MomenceMember | null> {
  return apiGet<MomenceMember>(`/host/members/${memberId}`, {});
}

export async function getMemberMemberships(memberId: number): Promise<MomenceMembership[]> {
  const data = await apiGet<Paginated<MomenceMembership>>(
    `/host/members/${memberId}/bought-memberships/active`,
    { page: 0, pageSize: 20 },
  );
  return data?.payload ?? [];
}

export async function getMemberBookings(memberId: number, pageSize = 8): Promise<MemberBooking[]> {
  const data = await apiGet<Paginated<MemberBooking>>(`/host/members/${memberId}/sessions`, {
    page: 0,
    pageSize,
    sortOrder: "DESC",
  });
  return data?.payload ?? [];
}

export type SessionAttendee = {
  bookingId: number;
  memberId: number;
  name: string;
  email: string | null;
  phone: string | null;
  checkedIn: boolean;
  ticketsBought: number;
  cancelled: boolean;
};

export async function listSessions(options: {
  query?: string;
  startAfter?: string;
  startBefore?: string;
  locationId?: number;
  teacherId?: number;
  pageSize?: number;
  types?: string[];
}): Promise<MomenceSession[]> {
  const extra = (options.types ?? []).map((t) => `types[]=${encodeURIComponent(t)}`).join("&");
  const data = await apiGet<Paginated<MomenceSession>>(
    `/host/sessions${extra ? `?${extra}` : ""}`,
    {
    page: 0,
    pageSize: options.pageSize ?? 60,
    sortBy: "startsAt",
    sortOrder: "DESC",
    startAfter: options.startAfter,
    startBefore: options.startBefore,
    locationId: options.locationId,
    teacherId: options.teacherId,
  });
  let rows = data?.payload ?? [];
  const q = options.query?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((s) => {
      const teacher = s.teacher ? `${s.teacher.firstName} ${s.teacher.lastName}` : "";
      return (
        s.name.toLowerCase().includes(q) ||
        teacher.toLowerCase().includes(q) ||
        (s.inPersonLocation?.name ?? "").toLowerCase().includes(q)
      );
    });
  }
  return rows;
}

/** Derive the distinct trainers and locations from a recent window of sessions. */
export async function getDirectory(): Promise<{
  trainers: { id: number; name: string; pictureUrl: string | null }[];
  locations: { id: number; name: string }[];
  classNames: string[];
}> {
  const now = new Date();
  const from = new Date(now.getTime() - 21 * 86400000).toISOString();
  const to = new Date(now.getTime() + 14 * 86400000).toISOString();
  const sessions = await listSessions({ startAfter: from, startBefore: to, pageSize: 200 });

  const trainers = new Map<number, { id: number; name: string; pictureUrl: string | null }>();
  const locations = new Map<number, { id: number; name: string }>();
  const classNames = new Set<string>();
  for (const s of sessions) {
    if (s.teacher) {
      trainers.set(s.teacher.id, {
        id: s.teacher.id,
        name: `${s.teacher.firstName} ${s.teacher.lastName}`.trim(),
        pictureUrl: s.teacher.pictureUrl,
      });
    }
    if (s.inPersonLocation) locations.set(s.inPersonLocation.id, s.inPersonLocation);
    if (s.name) classNames.add(s.name);
  }
  return {
    trainers: [...trainers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    locations: [...locations.values()].sort((a, b) => a.name.localeCompare(b.name)),
    classNames: [...classNames].sort(),
  };
}

export async function getSessionAttendees(sessionId: number): Promise<SessionAttendee[]> {
  type Row = {
    id: number;
    checkedIn: boolean;
    ticketsBought: number;
    cancelledAt: string | null;
    member: { id: number; firstName: string; lastName: string; email: string | null; phoneNumber: string | null } | null;
  };
  const data = await apiGet<Paginated<Row>>(`/host/sessions/${sessionId}/bookings`, {
    page: 0,
    pageSize: 60,
  });
  return (data?.payload ?? [])
    .filter((r) => r.member)
    .map((r) => ({
      bookingId: r.id,
      memberId: r.member!.id,
      name: `${r.member!.firstName ?? ""} ${r.member!.lastName ?? ""}`.trim(),
      email: r.member!.email,
      phone: r.member!.phoneNumber,
      checkedIn: r.checkedIn,
      ticketsBought: r.ticketsBought ?? 1,
      cancelled: !!r.cancelledAt,
    }));
}

export async function getSession(sessionId: number): Promise<MomenceSession | null> {
  return apiGet<MomenceSession>(`/host/sessions/${sessionId}`, {});
}

export function formatSession(session: MomenceSession): string {
  const start = new Date(session.startsAt);
  const when = start.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
  const teacher = session.teacher ? ` · ${session.teacher.firstName} ${session.teacher.lastName}` : "";
  return `${session.name} — ${when}${teacher}`;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

async function apiSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const auth = await getAccessToken();
  if (!auth) return { ok: false, error: "Momence is not connected" };
  const send = async (token: string) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  let res = await send(auth.token);
  if (res.status === 401) {
    const retry = await getAccessToken(true);
    if (!retry) return { ok: false, error: "Momence auth expired" };
    res = await send(retry.token);
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err =
      (parsed as { error?: string; message?: string })?.error ??
      (parsed as { message?: string })?.message ??
      `Momence responded ${res.status}`;
    return { ok: false, error: String(err) };
  }
  return { ok: true, data: (parsed ?? undefined) as T };
}

export function cancelBooking(bookingId: number, opts: { refund: boolean; notify: boolean; lateCancel: boolean }) {
  return apiSend(`DELETE`, `/host/session-bookings/${bookingId}`, {
    refund: opts.refund,
    disableNotifications: !opts.notify,
    isLateCancellation: opts.lateCancel,
  });
}

export function checkInBooking(bookingId: number, checkedIn: boolean) {
  return apiSend(checkedIn ? "POST" : "DELETE", `/host/session-bookings/${bookingId}/check-in`);
}

export function addMemberFree(sessionId: number, memberId: number) {
  return apiSend("POST", `/host/sessions/${sessionId}/bookings/free`, { memberId });
}

export function addMemberWaitlist(sessionId: number, memberId: number) {
  return apiSend("POST", `/host/sessions/${sessionId}/waitlist/bookings`, { memberId });
}

export function freezeMembership(
  memberId: number,
  boughtMembershipId: number,
  opts: { freezeAt?: string; unfreezeAt?: string },
) {
  return apiSend("PUT", `/host/members/${memberId}/bought-memberships/${boughtMembershipId}/membership-freeze`, {
    freezeType: opts.freezeAt ? "scheduled" : "now",
    freezeAt: opts.freezeAt ?? null,
    unfreezeType: opts.unfreezeAt ? "scheduled" : "not_set",
    unfreezeAt: opts.unfreezeAt ?? null,
  });
}

export function unfreezeMembership(memberId: number, boughtMembershipId: number) {
  return apiSend("DELETE", `/host/members/${memberId}/bought-memberships/${boughtMembershipId}/membership-freeze`);
}

export function updateCredits(memberId: number, boughtMembershipId: number, credits: number) {
  return apiSend("PUT", `/host/members/${memberId}/bought-memberships/${boughtMembershipId}/credits`, {
    eventCredits: credits,
  });
}

export async function getSessionBookingsRaw(sessionId: number) {
  return apiGet<{ payload: unknown[] }>(`/host/sessions/${sessionId}/bookings`, { page: 0, pageSize: 60 });
}

export async function momenceStatus(): Promise<{ connected: boolean; hostId: number | null }> {
  const auth = await getAccessToken();
  return { connected: !!auth, hostId: auth?.hostId ?? null };
}
