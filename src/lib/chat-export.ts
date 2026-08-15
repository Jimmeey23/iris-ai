import type { ChatMessage } from "./types";

export type ExportMeta = {
  reporter: string;
  role: string;
  startedAt: string;
  ticketNumber?: string;
};

function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function stripMd(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/_(.+?)_/g, "$1");
}

export function toPlainText(messages: ChatMessage[], meta: ExportMeta): string {
  const lines = [
    "PHYSIQUE 57 — IRIS AI",
    "Iris intake transcript",
    "".padEnd(48, "="),
    `Reporter : ${meta.reporter} (${meta.role})`,
    `Started  : ${stamp(meta.startedAt)}`,
    meta.ticketNumber ? `Ticket   : ${meta.ticketNumber}` : "",
    "".padEnd(48, "="),
    "",
  ].filter(Boolean);

  for (const m of messages) {
    const who = m.role === "assistant" ? "IRIS" : meta.reporter.toUpperCase();
    lines.push(`[${stamp(m.createdAt)}] ${who}`);
    lines.push(stripMd(m.content));
    if (m.inferred?.length) lines.push(`  detected: ${m.inferred.join(" | ")}`);
    if (m.analysis?.length) lines.push(`  analysis: ${m.analysis.map((a) => `${a.label}=${a.value}`).join(", ")}`);
    if (m.draft) {
      const d = m.draft;
      lines.push(
        "  --- DRAFT ---",
        `  Title      : ${d.title}`,
        `  Category   : ${d.category} > ${d.subcategory}`,
        `  Priority   : ${d.priority} (${d.severity})`,
        `  SLA        : respond ${d.slaRespondHours}h / resolve ${d.slaResolveHours}h`,
        `  Sentiment  : ${d.sentiment} / ${d.emotion}`,
        `  Urgency    : ${d.urgencyScore}/100  Churn: ${d.churnRisk}  Effort: ${d.effort}`,
        `  Root cause : ${d.rootCause}`,
        `  Action     : ${d.suggestedAction}`,
      );
    }
    if (m.created) lines.push(`  --- RAISED: ${m.created.ticketNumber} -> ${m.created.assigneeName ?? "triage"} ---`);
    lines.push("");
  }
  return lines.join("\n");
}

export function toJson(messages: ChatMessage[], meta: ExportMeta): string {
  return JSON.stringify(
    {
      product: "Physique 57 IRIS Ai",
      export: "iris-transcript",
      exportedAt: new Date().toISOString(),
      meta,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        at: m.createdAt,
        content: stripMd(m.content),
        inferred: m.inferred ?? [],
        analysis: m.analysis ?? [],
        draft: m.draft ?? null,
        created: m.created ?? null,
      })),
    },
    null,
    2,
  );
}

export function toMarkdown(messages: ChatMessage[], meta: ExportMeta): string {
  const out = [
    `# Iris intake transcript`,
    ``,
    `**Reporter:** ${meta.reporter} — ${meta.role}  `,
    `**Started:** ${stamp(meta.startedAt)}  `,
    meta.ticketNumber ? `**Ticket:** ${meta.ticketNumber}  ` : "",
    ``,
    `---`,
    ``,
  ].filter(Boolean);
  for (const m of messages) {
    out.push(`**${m.role === "assistant" ? "Iris" : meta.reporter}** · _${stamp(m.createdAt)}_`, ``, m.content, ``);
    if (m.draft) {
      out.push(
        `> **${m.draft.title}**  `,
        `> ${m.draft.category} › ${m.draft.subcategory} · ${m.draft.priority} · ${m.draft.severity}  `,
        `> SLA ${m.draft.slaResolveHours}h · urgency ${m.draft.urgencyScore}/100 · churn ${m.draft.churnRisk}`,
        ``,
      );
    }
  }
  return out.join("\n");
}

export function toHtml(messages: ChatMessage[], meta: ExportMeta): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const md = (s: string) =>
    esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/_(.+?)_/g, "<em>$1</em>").replace(/\n/g, "<br/>");

  const bubbles = messages
    .map((m) => {
      const mine = m.role === "user";
      const draft = m.draft
        ? `<div class="draft">
            <div class="dt">${esc(m.draft.title)}</div>
            <div class="dm">${esc(m.draft.category)} › ${esc(m.draft.subcategory)}</div>
            <div class="grid">
              <span><b>Priority</b>${esc(m.draft.priority)}</span>
              <span><b>Severity</b>${esc(m.draft.severity)}</span>
              <span><b>SLA</b>${m.draft.slaResolveHours}h</span>
              <span><b>Urgency</b>${m.draft.urgencyScore}/100</span>
              <span><b>Churn</b>${esc(m.draft.churnRisk)}</span>
              <span><b>Effort</b>${esc(m.draft.effort)}</span>
            </div>
            <p><b>Root cause</b> ${esc(m.draft.rootCause)}</p>
            <p><b>Recommended</b> ${esc(m.draft.suggestedAction)}</p>
          </div>`
        : "";
      const created = m.created
        ? `<div class="raised">Raised ${esc(m.created.ticketNumber)} → ${esc(m.created.assigneeName ?? "triage")}</div>`
        : "";
      const chips = m.inferred?.length
        ? `<div class="chips">${m.inferred.map((c) => `<span>${esc(c)}</span>`).join("")}</div>`
        : "";
      return `<div class="row ${mine ? "me" : ""}">
        <div class="who">${mine ? esc(meta.reporter) : "Iris"} · ${stamp(m.createdAt)}</div>
        <div class="bubble">${md(m.content)}${chips}</div>${draft}${created}
      </div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Iris transcript — ${esc(meta.reporter)}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
 body{font-family:Outfit,system-ui,sans-serif;background:#fff;color:#0e1729;margin:0;padding:40px 20px;}
 .wrap{max-width:760px;margin:0 auto;}
 h1{font-family:'Instrument Serif',serif;font-size:34px;margin:0 0 4px;font-weight:400;}
 .meta{font-size:11px;text-transform:uppercase;letter-spacing:.2em;color:#5c6578;margin-bottom:28px;}
 .row{margin-bottom:18px;}
 .row.me{text-align:right;}
 .who{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#5c6578;margin-bottom:5px;}
 .bubble{display:inline-block;max-width:86%;text-align:left;padding:10px 14px;border-radius:16px;background:#fff;box-shadow:inset 0 0 0 1px #efefef;font-size:13.5px;line-height:1.6;}
 .row.me .bubble{background:#005eed;color:#fff;box-shadow:none;}
 .chips{margin-top:8px;}
 .chips span{display:inline-block;background:rgba(0,94,237,.1);color:#005eed;border-radius:999px;padding:2px 8px;font-size:10px;margin:2px 3px 0 0;}
 .draft{margin-top:10px;padding:14px 16px;border-radius:16px;box-shadow:inset 0 0 0 1px #efefef;text-align:left;}
 .dt{font-family:'Instrument Serif',serif;font-size:19px;}
 .dm{font-size:11px;color:#5c6578;margin:4px 0 10px;}
 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;}
 .grid span{background:#efefef;border-radius:10px;padding:6px 8px;font-size:12px;display:block;}
 .grid b{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#5c6578;font-weight:600;}
 .draft p{font-size:12px;color:#3c4557;margin:4px 0;}
 .raised{margin-top:8px;display:inline-block;background:rgba(6,122,75,.09);color:#067a4b;border-radius:12px;padding:6px 12px;font-size:12px;font-weight:600;}
 footer{margin-top:36px;border-top:1px solid #efefef;padding-top:14px;font-size:10px;color:#5c6578;letter-spacing:.14em;text-transform:uppercase;}
</style></head><body><div class="wrap">
<h1>Iris intake transcript</h1>
<div class="meta">${esc(meta.reporter)} · ${esc(meta.role)} · ${stamp(meta.startedAt)}${meta.ticketNumber ? ` · ${esc(meta.ticketNumber)}` : ""}</div>
${bubbles}
<footer>Physique 57 — IRIS Ai · exported ${stamp(new Date().toISOString())}</footer>
</div></body></html>`;
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Renders the transcript to a PNG via an SVG foreignObject canvas draw. */
export async function toPng(node: HTMLElement, filename: string): Promise<void> {
  const rect = node.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(node.scrollHeight);
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.overflow = "visible";
  clone.style.background = getComputedStyle(document.body).backgroundColor || "#ffffff";

  const styles = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml"><style>${styles}</style>${clone.outerHTML}</div>
    </foreignObject></svg>`;

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("render failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  const scale = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);

  await new Promise<void>((resolve) =>
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      resolve();
    }, "image/png"),
  );
}

/** Opens a print-ready window so the browser can save it as a PDF. */
export function toPdf(messages: ChatMessage[], meta: ExportMeta) {
  const win = window.open("", "_blank", "width=860,height=1000");
  if (!win) return;
  win.document.write(toHtml(messages, meta));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 550);
}
