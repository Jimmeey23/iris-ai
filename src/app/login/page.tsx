"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    router.replace(searchParams.get("next") || "/");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="card panel p-8 w-full max-w-sm animate-rise">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-light.png" alt="IRIS Ai" className="mb-4 h-10 w-auto object-contain object-left dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="IRIS Ai" className="mb-4 hidden h-10 w-auto object-contain object-left dark:block" />
        <h1 className="serif text-2xl mb-1">IRIS Ai</h1>
        <p className="txt text-sm opacity-70 mb-6">Sign in with your work email to continue.</p>
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
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
