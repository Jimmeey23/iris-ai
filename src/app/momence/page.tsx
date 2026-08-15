import MomenceConsole from "@/components/MomenceConsole";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { getStudios } from "@/lib/tickets";
import { momenceStatus } from "@/lib/momence";

export const dynamic = "force-dynamic";

export default async function MomencePage() {
  await ensureSeeded();
  const [studios, status] = await Promise.all([getStudios(), momenceStatus()]);

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Operations console"
        title="Momence"
        description="Search members and classes, run 360 lookups, manage bookings and check-ins, freeze or unfreeze memberships and adjust credits — without leaving IRIS Ai."
        action={
          <span
            className="chip"
            style={{
              background: status.connected ? "var(--mint-soft)" : "var(--danger-soft)",
              color: status.connected ? "var(--mint)" : "var(--danger)",
            }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${status.connected ? "live-dot" : ""}`}
              style={{ background: status.connected ? "var(--mint)" : "var(--danger)" }}
            />
            {status.connected ? `Host ${status.hostId}` : "Disconnected"}
          </span>
        }
      />
      <MomenceConsole studios={studios} />
    </div>
  );
}
