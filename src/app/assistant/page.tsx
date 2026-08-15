import ChatAssistant from "@/components/ChatAssistant";
import { ensureSeeded } from "@/lib/seed";
import { getStudios } from "@/lib/tickets";
import { hasOpenAi } from "@/lib/enrich";
import { CATEGORIES, TAXONOMY } from "@/lib/taxonomy";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  await ensureSeeded();
  const [studios, openai] = await Promise.all([getStudios(), hasOpenAi()]);
  const subCount = CATEGORIES.reduce((sum, c) => sum + TAXONOMY[c].length, 0);

  return (
    <div className="w-full px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip chip-line">{CATEGORIES.length} categories · {subCount} subcategories</span>
        <Link
          href="/settings"
          className="chip"
          style={{
            background: openai ? "var(--mint-soft)" : "var(--surface-3)",
            color: openai ? "var(--mint)" : "var(--text-3)",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: openai ? "var(--mint)" : "var(--text-3)" }} />
          {openai ? "OpenAI enabled" : "Add OpenAI key"}
        </Link>
        <span className="ml-auto text-[10px] uppercase tracking-[0.18em] txt-3">Esc closes any panel</span>
      </div>
      <ChatAssistant studios={studios} />
    </div>
  );
}
