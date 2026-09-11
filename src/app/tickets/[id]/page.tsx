import Link from "next/link";
import { notFound } from "next/navigation";
import TicketWorkspace from "@/components/TicketWorkspace";
import { ensureSeeded } from "@/lib/seed";
import { getStaff, getTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) notFound();

  const [data, staff] = await Promise.all([getTicket(numericId), getStaff()]);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1.5 text-[12px] font-medium txt-3 transition hover:accent-txt"
      >
        ← Back to all tickets
      </Link>
      <TicketWorkspace ticket={data.ticket} events={data.events} staff={staff} linked={data.linked} similar={data.similar} />
    </div>
  );
}
