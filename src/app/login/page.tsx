"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11C3.24 21.3 7.29 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27c-.24-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.62H1.26A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.26 5.38l4.01-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.45-3.45C17.95 1.19 15.24 0 12 0 7.29 0 3.24 2.7 1.26 6.62l4.01 3.11c.95-2.85 3.6-4.98 6.73-4.98z"
      />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const next = searchParams.get("next") || "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message || "Invalid email or password.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function handleGoogleSignIn() {
    setError("");
    setGoogleLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (oauthError) {
      setError(oauthError.message || "Could not start Google sign-in.");
      setGoogleLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="orbs">
        <div className="orb-a" />
        <div className="orb-b" />
      </div>
      <div className="grain" />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-2">
        {/* Brand panel */}
        <div className="hidden lg:flex flex-col justify-between p-12 border-r hairline">
          <div className="flex items-center gap-3 animate-rise">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-light.png" alt="IRIS Ai" className="h-9 w-auto object-contain dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-dark.png" alt="IRIS Ai" className="hidden h-9 w-auto object-contain dark:block" />
          </div>

          <div className="animate-rise" style={{ animationDelay: "0.06s" }}>
            <p className="eyebrow mb-4">Trainer intelligence, refined</p>
            <h1 className="serif text-5xl leading-tight mb-4 max-w-md">
              Insight, reporting and coaching — in one place.
            </h1>
            <p className="txt-2 text-sm max-w-sm">
              Sign in with your work account to access tickets, templates and trainer reports.
            </p>
          </div>

          <p className="txt-3 text-xs animate-rise" style={{ animationDelay: "0.12s" }}>
            © {new Date().getFullYear()} Physique 57 India
          </p>
        </div>

        {/* Form panel */}
        <div className="flex items-center justify-center px-4 py-12">
          <form
            onSubmit={handleSubmit}
            className="card sheen panel p-8 w-full max-w-sm animate-slide-up"
          >
            <div className="lg:hidden mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-light.png" alt="IRIS Ai" className="h-9 w-auto object-contain dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-dark.png" alt="IRIS Ai" className="hidden h-9 w-auto object-contain dark:block" />
            </div>

            <h2 className="serif text-2xl mb-1">Welcome back</h2>
            <p className="txt-3 text-sm mb-6">Sign in to continue to IRIS Ai.</p>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="btn btn-solid w-full mb-4"
            >
              <GoogleIcon />
              {googleLoading ? "Redirecting…" : "Continue with Google"}
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 hairline border-t" />
              <span className="txt-3 text-[11px] uppercase tracking-wider">or</span>
              <div className="h-px flex-1 hairline border-t" />
            </div>

            <input
              type="email"
              className="field w-full mb-3"
              placeholder="you@physique57india.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <input
              type="password"
              className="field w-full mb-3"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error ? <p className="text-sm mb-3 danger-soft rounded px-3 py-2">{error}</p> : null}
            <button type="submit" className="btn btn-primary w-full" disabled={loading || !email || !password}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
