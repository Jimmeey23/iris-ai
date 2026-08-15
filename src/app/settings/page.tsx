import SettingsPanel from "@/components/SettingsPanel";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { getSettings, maskSecret } from "@/lib/settings";
import { momenceStatus } from "@/lib/momence";
import { integrationStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await ensureSeeded();
  const raw = await getSettings();
  const [momence, status] = await Promise.all([momenceStatus(), integrationStatus()]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Connect the AI engine, Momence, Fillout, Supabase, Mailtrap, n8n and respond.io — then tune SLA policy, notification rules and queue guardrails."
      />
      <SettingsPanel
        initial={{
          ...raw,
          openai_api_key: maskSecret(raw.openai_api_key ?? ""),
          openai_model: raw.openai_model ?? "gpt-4o-mini",
          momence_client_secret: maskSecret(raw.momence_client_secret ?? ""),
          momence_password: maskSecret(raw.momence_password ?? ""),
          fillout_supabase_token: maskSecret(raw.fillout_supabase_token ?? ""),
          fillout_webhook_secret: maskSecret(raw.fillout_webhook_secret ?? ""),
          fillout_api_key: maskSecret(raw.fillout_api_key ?? ""),
          fillout_base_url: raw.fillout_base_url ?? "",
          supabase_service_key: maskSecret(raw.supabase_service_key ?? ""),
          mailtrap_token: maskSecret(raw.mailtrap_token ?? ""),
          n8n_secret: maskSecret(raw.n8n_secret ?? ""),
          respondio_token: maskSecret(raw.respondio_token ?? ""),
        }}
        momenceConnected={momence.connected}
        momenceHostId={momence.hostId}
        status={status}
      />
    </div>
  );
}
