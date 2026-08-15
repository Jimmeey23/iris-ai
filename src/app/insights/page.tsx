import SignalsBoard from "@/components/SignalsBoard";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  await ensureSeeded();
  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Predictive intelligence"
        title="Signals"
        description="Forecasts, anomalies and emerging patterns across ticket volume, SLA risk, member churn and trainer performance — recalculated from live data every time you open the page."
      />
      <SignalsBoard />
    </div>
  );
}
