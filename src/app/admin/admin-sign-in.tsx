"use client";

import { useState } from "react";

export function AdminSignIn() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    if (response?.ok) {
      window.location.reload();
      return;
    }
    const body = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    setError(body?.error ?? "Could not sign in. Try again.");
    setBusy(false);
  }

  return (
    <main className="flex justify-center px-4 py-16">
      <form
        onSubmit={signIn}
        className="neo-panel flex w-full max-w-sm flex-col gap-4 rounded-lg p-6"
      >
        <h1 className="text-2xl font-bold">Operator sign in</h1>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Operator token
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="neo-input h-11 rounded-md bg-white px-3 font-mono text-base"
            autoFocus
          />
        </label>
        {error ? (
          <p
            role="alert"
            className="text-sm font-medium text-red-700 dark:text-red-400"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !token}
          className="neo-button h-11 rounded-md px-4 font-semibold disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
