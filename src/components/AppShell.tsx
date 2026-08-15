"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme, useUser } from "./Providers";
import { useEscape } from "@/lib/use-escape";
import { Avatar } from "./ui";
import { apiFetch } from "@/lib/api-client";

const RAIL = [
  { href: "/", label: "Home", icon: "◧", title: "Dashboard" },
  { href: "/assistant", label: "Iris", icon: "✦", title: "AI Assistant" },
  { href: "/templates", label: "Intake", icon: "▤", title: "Templates" },
  { href: "/tickets", label: "Queue", icon: "≡", title: "Tickets" },
  { href: "/trainers", label: "Team", icon: "◑", title: "Trainers" },
  { href: "/forms", label: "Forms", icon: "✎", title: "Evaluation forms" },
  { href: "/momence", label: "Momence", icon: "⬡", title: "Momence operations" },
  { href: "/reports", label: "Reports", icon: "◔", title: "Reports" },
  { href: "/insights", label: "Signals", icon: "◈", title: "Insights" },
];

const PAGE_TITLES: Record<string, { title: string; eyebrow: string }> = {
  "/": { title: "Command Centre", eyebrow: "Live studio pulse" },
  "/assistant": { title: "Iris Assistant", eyebrow: "Conversational intake" },
  "/templates": { title: "Quick Forms", eyebrow: "Structured capture" },
  "/tickets": { title: "Ticket Queue", eyebrow: "Track to closure" },
  "/trainers": { title: "Training Academy", eyebrow: "Instructor performance" },
  "/forms": { title: "Evaluation Forms", eyebrow: "Fillout capture" },
  "/momence": { title: "Momence Console", eyebrow: "Operations toolkit" },
  "/reports": { title: "Reports", eyebrow: "Analytics workbench" },
  "/insights": { title: "Signals", eyebrow: "Feedback intelligence" },
  "/settings": { title: "Settings", eyebrow: "Integrations & AI" },
};

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[13px] txt-3 transition hover:txt"
      style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--line)" }}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

function UserMenu() {
  const { user, users, setUserId } = useUser();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEscape(open, () => setOpen(false));
  const filtered = q
    ? users.filter((u) => `${u.name} ${u.role} ${u.studio}`.toLowerCase().includes(q.toLowerCase()))
    : users;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition"
        style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--line)" }}
      >
        <Avatar name={user.name} color={user.color} size={24} />
        <span className="hidden text-left leading-none sm:block">
          <span className="block text-[11.5px] font-medium txt">{user.name.split(" ")[0]}</span>
          <span className="mt-0.5 block text-[8.5px] uppercase tracking-[0.14em] txt-3">{user.studio}</span>
        </span>
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-label="close" />
          <div
            className="animate-pop absolute right-0 top-full z-40 mt-2 w-[280px] rounded-2xl p-2"
            style={{ background: "var(--surface)", border: "1px solid var(--line)", boxShadow: "var(--shadow-lg)" }}
          >
            <div className="mb-1.5 px-1 text-[9px] uppercase tracking-[0.2em] txt-3">Filing as</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team…" className="field !py-1.5 !text-[12px]" />
            <div className="hide-scrollbar mt-1.5 max-h-[290px] overflow-y-auto">
              {filtered.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setUserId(u.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-[var(--surface-3)]"
                  style={u.id === user.id ? { background: "var(--accent-soft)" } : undefined}
                >
                  <Avatar name={u.name} color={u.color} size={26} />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[12px] font-medium txt">{u.name}</span>
                    <span className="block truncate text-[10px] txt-3">{u.role}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [momence, setMomence] = useState<boolean | null>(null);
  const [mobile, setMobile] = useState(false);
  useEscape(mobile, () => setMobile(false));

  const isLogin = pathname === "/login";

  useEffect(() => {
    if (isLogin) return;
    apiFetch<{ connected?: boolean }>("/api/momence?resource=status")
      .then((d) => setMomence(!!d.connected))
      .catch(() => setMomence(false));
  }, [isLogin]);

  if (isLogin) return <>{children}</>;

  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const meta =
    PAGE_TITLES[Object.keys(PAGE_TITLES).find((k) => (k === "/" ? pathname === "/" : pathname.startsWith(k))) ?? "/"] ??
    PAGE_TITLES["/"];

  const rail = (
    <>
      <div className="flex h-[66px] items-center justify-center border-b hairline">
        <Link href="/" className="flex h-10 w-10 items-center justify-center rounded-2xl" title="IRIS Ai">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-light.png" alt="IRIS Ai" className="h-10 w-10 rounded-2xl object-cover dark:hidden" style={{ boxShadow: "var(--glow)" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-dark.png" alt="IRIS Ai" className="hidden h-10 w-10 rounded-2xl object-cover dark:block" style={{ boxShadow: "var(--glow)" }} />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col items-center gap-1 py-3">
        {RAIL.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rail-btn"
            data-active={active(item.href)}
            title={item.title}
            onClick={() => setMobile(false)}
          >
            <span className="rail-icon text-[15px] leading-none">{item.icon}</span>
            <span className="mt-1 text-[7.5px] uppercase tracking-[0.12em]">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="flex flex-col items-center gap-2 border-t py-3 hairline">
        <Link href="/settings" className="rail-btn !h-9 !w-9" data-active={active("/settings")} title="Settings">
          <span className="rail-icon text-[13px]">⚙</span>
        </Link>
      </div>
    </>
  );

  return (
    <div className="relative flex min-h-screen">
      <aside
        className="sticky top-0 hidden h-screen w-[74px] shrink-0 flex-col border-r lg:flex hairline"
        style={{ background: "var(--surface)" }}
      >
        {rail}
      </aside>

      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0" style={{ background: "rgba(14,23,41,0.4)" }} onClick={() => setMobile(false)} aria-label="close" />
          <aside
            className="animate-pop absolute left-0 top-0 flex h-full w-[74px] flex-col border-r hairline"
            style={{ background: "var(--surface)" }}
          >
            {rail}
          </aside>
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b px-4 py-3 backdrop-blur-xl lg:px-6 hairline"
          style={{ background: "color-mix(in srgb, var(--surface) 88%, transparent)" }}
        >
          <button
            className="rounded-xl p-2 text-[14px] txt-3 lg:hidden"
            style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
            onClick={() => setMobile(true)}
            aria-label="Open menu"
          >
            ☰
          </button>

          <div className="min-w-0">
            <h1 className="serif truncate text-[26px] leading-none txt">{meta.title}</h1>
            <div className="eyebrow mt-1.5">{meta.eyebrow}</div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium sm:inline-flex"
              style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--line)" }}
              title={momence ? "Momence API connected" : "Momence API offline"}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${momence ? "live-dot" : ""}`}
                style={{ background: momence ? "var(--accent)" : "var(--text-3)" }}
              />
              <span className="txt-3">Momence</span>
            </span>
            <Link href="/assistant" className="btn btn-primary hidden sm:inline-flex">
              ✦ New ticket
            </Link>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
