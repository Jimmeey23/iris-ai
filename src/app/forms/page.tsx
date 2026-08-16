import FilloutForms from "@/components/FilloutForms";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { getAllForms } from "@/lib/fillout";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  await ensureSeeded();
  const forms = await getAllForms();

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Evaluation forms"
        title="Forms"
        description="The Fillout/Zite forms embedded in-app, plus any you've added yourself. Pick a card to fill it out — submissions and review history live on the Reviews tab."
        action={
          <div className="flex items-center gap-2">
            <span className="chip chip-line">{forms.length} forms</span>
            <a href="/settings" className="btn btn-ghost">Configure</a>
          </div>
        }
      />
      <FilloutForms
        forms={forms.map((f) => ({
          key: f.key,
          name: f.name,
          blurb: f.blurb,
          template: f.template,
          embedId: f.embedId,
          embedKind: f.embedKind,
          height: f.height,
          icon: f.icon,
          apiPollable: f.apiPollable,
        }))}
      />
    </div>
  );
}
