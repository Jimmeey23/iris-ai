import Link from "next/link";
import InboxComposer from "@/components/InboxComposer";
import { ensureSeeded } from "@/lib/seed";
import { listInbound } from "@/lib/inbound-email";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  ticketed: "var(--mint)",
  duplicate: "var(--warn)",
  rejected: "var(--danger)",
  received: "var(--accent)",
};

export default async function InboxPage() {
  await ensureSeeded();
  const emails = await listInbound();

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] txt-3">Inbound</p>
        <h1 className="serif text-[26px] leading-tight txt">Email inbox</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] txt-3">
          Every email that reaches Iris — via the provider webhook or pasted here — becomes a triaged, routed
          ticket with a draft reply held for your approval. Nothing is ever auto-sent to the sender.
        </p>
      </div>

      <InboxComposer />

      <div className="panel overflow-hidden rounded-2xl">
        <header className="border-b px-5 py-3.5 hairline">
          <h2 className="serif text-[17px] leading-none txt">Latest emails</h2>
        </header>
        {emails.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12.5px] txt-3">
            Nothing yet. Paste a forwarded email above, or point your provider&apos;s inbound webhook at
            <code className="mx-1 rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--surface-3)" }}>
              POST /api/inbound/email
            </code>
            and watch tickets appear.
          </p>
        ) : (
          <ul className="divide-y hairline">
            {emails.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
                <span className="chip !text-[9px]" style={{ background: "var(--surface-3)", color: STATUS_TONE[m.status] ?? "var(--text)" }}>
                  {m.status}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium txt">{m.subject}</p>
                  <p className="truncate text-[11.5px] txt-3">
                    {m.fromName ? `${m.fromName} · ` : ""}
                    {m.fromEmail} · {m.receivedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}
                    {m.triageNote ? ` · ${m.triageNote}` : ""}
                  </p>
                </div>
                {m.ticketId ? (
                  <Link href={`/tickets/${m.ticketId}`} className="btn !h-8 !text-[11.5px]">
                    Open ticket →
                  </Link>
                ) : (
                  <span className="text-[11.5px] txt-3">no ticket</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
