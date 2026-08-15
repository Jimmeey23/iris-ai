import ReportsWorkbench from "@/components/ReportsWorkbench";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { getStudios } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await ensureSeeded();
  const studios = await getStudios();

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="Generate any of the standard reports across a chosen period, studio, department or category — then sort, filter and export to CSV."
        action={
          <div className="flex items-center gap-2">
            <span className="chip accent-soft">29 report types</span>
            <span className="chip chip-line">6 groups</span>
          </div>
        }
      />
      <ReportsWorkbench studios={studios.map((s) => `${s.name}, ${s.city}`)} />
    </div>
  );
}
