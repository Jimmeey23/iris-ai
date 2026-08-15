"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_USER, TEAM_USERS, type TeamUser } from "@/lib/users";

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

const UserContext = createContext<{ user: TeamUser; setUserId: (id: string) => void; users: TeamUser[] }>({
  user: DEFAULT_USER,
  setUserId: () => {},
  users: TEAM_USERS,
});

export function useUser() {
  return useContext(UserContext);
}

export function Providers({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [userId, setUserId] = useState<string>(DEFAULT_USER.id);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("p57.theme") as Theme | null;
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const next = storedTheme ?? (prefersDark ? "dark" : "light");
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");

    const storedUser = window.localStorage.getItem("p57.user");
    if (storedUser && TEAM_USERS.some((u) => u.id === storedUser)) setUserId(storedUser);
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

  const userValue = useMemo(
    () => ({
      user: TEAM_USERS.find((u) => u.id === userId) ?? DEFAULT_USER,
      setUserId: (id: string) => {
        setUserId(id);
        window.localStorage.setItem("p57.user", id);
      },
      users: TEAM_USERS,
    }),
    [userId],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <UserContext.Provider value={userValue}>{children}</UserContext.Provider>
    </ThemeContext.Provider>
  );
}
