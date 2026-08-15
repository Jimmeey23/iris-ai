import Link from "next/link";
import TicketsExplorer from "@/components/TicketsExplorer";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { getStaff, getStudios, listTickets } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; category?: string }>;
}) {
  await ensureSeeded();
  const params = await searchParams;
  const [tickets, studios, staff] = await Promise.all([
    listTickets({ limit: 2000 }),
    getStudios(),
    getStaff(),
  ]);

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Tracker"
        title="All tickets"
        description="One centralised queue for every studio, department and owner. Filter, drill in and drive tickets to completion."
        action={
          <div className="flex gap-2">
            <Link href="/templates" className="btn btn-ghost">
              Templates
            </Link>
            <Link href="/assistant" className="btn btn-primary">
              ✦ New ticket
            </Link>
          </div>
        }
      />
      <TicketsExplorer
        tickets={tickets}
        studios={studios}
        staff={staff}
        initial={{ status: params.status, priority: params.priority, category: params.category }}
      />
    </div>
  );
}
