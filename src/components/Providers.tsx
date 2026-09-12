"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { colorFor } from "@/lib/org";
import type { Role } from "@/lib/session";

/* ---------------- theme ---------------- */

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/* ---------------- user ---------------- */

export type SessionTeamUser = {
  id: string;
  name: string;
  role: string; // job title, e.g. "Ops Manager" — used for ticket-ownership overrides
  studio: string;
  initials: string;
  color: string;
  email: string;
  accessRole: Role;
  department: string;
};

const EMPTY_USER: SessionTeamUser = {
  id: "",
  name: "",
  role: "",
  studio: "",
  initials: "",
  color: "#6366f1",
  email: "",
  accessRole: "executive",
  department: "",
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const UserContext = createContext<{ user: SessionTeamUser; loading: boolean; signOut: () => Promise<void> }>({
  user: EMPTY_USER,
  loading: true,
  signOut: async () => {},
});

export function useUser() {
  return useContext(UserContext);
}

export function Providers({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [user, setUser] = useState<SessionTeamUser>(EMPTY_USER);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("p57.theme") as Theme | null;
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const next = storedTheme ?? (prefersDark ? "dark" : "light");
    // The stored theme is browser-only, so the first paint uses the default.
    // The class lands immediately; React state settles on the next frame rather
    // than cascading a second render out of the effect body.
    document.documentElement.classList.toggle("dark", next === "dark");
    const settle = requestAnimationFrame(() => setTheme(next));

    apiFetch<{ user?: { id: string; name: string; email: string; role: Role; department: string; jobTitle: string; studio: string } }>("/api/auth/me")
      .then((data) => {
        if (!data?.user) return;
        const u = data.user as {
          id: string;
          name: string;
          email: string;
          role: Role;
          department: string;
          jobTitle: string;
          studio: string;
        };
        setUser({
          id: u.id,
          name: u.name,
          role: u.jobTitle,
          studio: u.studio,
          initials: initials(u.name),
          color: colorFor(u.id),
          email: u.email,
          accessRole: u.role,
          department: u.department,
        });
      })
      .catch((error: unknown) => {
        console.error("Unable to load the signed-in profile", error);
      })
      .finally(() => setLoading(false));
    return () => cancelAnimationFrame(settle);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      window.localStorage.setItem("p57.theme", next);
      return next;
    });
  }, []);

  const themeValue = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  const signOut = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }, []);

  const userValue = useMemo(() => ({ user, loading, signOut }), [user, loading, signOut]);

  return (
    <ThemeContext.Provider value={themeValue}>
      <UserContext.Provider value={userValue}>{children}</UserContext.Provider>
    </ThemeContext.Provider>
  );
}
