import Link from "next/link";
import type { Ticket } from "@/db/schema";
import { CATEGORY_META } from "@/lib/taxonomy";
import { Avatar, PriorityPill, StatusPill, slaLabel, timeAgo } from "./ui";

export default function TicketRow({ ticket, dense = false }: { ticket: Ticket; dense?: boolean }) {
  const meta = CATEGORY_META[ticket.category];
  const sla = slaLabel(ticket.slaDueAt, ticket.status);
  const escalated = ticket.sentiment === "Escalated" || ticket.churnRisk === "High";

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="group row-reveal relative flex items-center gap-3.5 px-4 py-3 transition hover:bg-[var(--surface-3)]"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-[14px]"
        style={{ background: "var(--surface-3)" }}
      >
        {meta?.icon ?? "•"}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium txt group-hover:accent-txt">
            {ticket.title}
          </span>
          {escalated && (
            <span className="chip signal-soft shrink-0 !px-1.5 !py-0 !text-[9.5px]">!</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] txt-3">
          <span className="font-medium tabular">{ticket.ticketNumber}</span>
          <span className="opacity-40">·</span>
          <span className="truncate">{ticket.subcategory}</span>
          <span className="opacity-40">·</span>
          <span className="truncate">{ticket.studioName.split(",")[0]}</span>
          {!dense && ticket.memberName && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate">{ticket.memberName}</span>
            </>
          )}
          <span className="opacity-40">·</span>
          <span suppressHydrationWarning>{timeAgo(ticket.createdAt)}</span>
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
        <span className={`text-[10.5px] font-medium tabular ${sla.tone}`} suppressHydrationWarning>
          {sla.text}
        </span>
        <StatusPill status={ticket.status} />
        <PriorityPill priority={ticket.priority} />
        <Avatar name={ticket.assigneeName} size={26} />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
        <PriorityPill priority={ticket.priority} />
      </div>
    </Link>
  );
}
