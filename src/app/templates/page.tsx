import Link from "next/link";
import TemplateBoard from "@/components/TemplateBoard";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { getStudios } from "@/lib/tickets";
import { TEMPLATES } from "@/lib/templates";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customTemplates } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await ensureSeeded();
  const [studios, custom] = await Promise.all([
    getStudios(),
    db.select().from(customTemplates).where(eq(customTemplates.active, true)).orderBy(asc(customTemplates.name)),
  ]);

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Quick raise"
        title="Templates"
        description="Structured forms for the issues we see most often. Attach a member, class or trainer from Momence and the ticket is enriched and routed on submit."
        action={
          <div className="flex items-center gap-2">
            <span className="chip chip-line">{TEMPLATES.length + custom.length} templates</span>
            <Link href="/assistant" className="btn btn-ghost">
              Use Iris instead
            </Link>
          </div>
        }
      />
      <TemplateBoard studios={studios} custom={custom} />
    </div>
  );
}
