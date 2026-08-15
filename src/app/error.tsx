"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="card panel p-8 w-full max-w-md text-center animate-rise">
        <p className="eyebrow mb-2">Something went wrong</p>
        <h1 className="serif text-2xl mb-2">This page hit a snag</h1>
        <p className="txt-2 text-sm mb-6">{error.message || "An unexpected error occurred."}</p>
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
      </div>
    </div>
  );
}
