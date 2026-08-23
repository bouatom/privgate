"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm({
  entra,
  local,
  continueSetup,
}: {
  entra: boolean;
  local: boolean;
  continueSetup: boolean;
}) {
  const nextParam = useSearchParams().get("next") || "/dashboard";
  const next = continueSetup ? "/setup" : nextParam;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setBusy(false);
      const code = body.error || "";
      if (code === "disabled") {
        setError("This portal account is disabled. Contact a Master Admin.");
      } else if (code === "sso required") {
        setError("This account uses Entra SSO. Use Sign in with Entra ID.");
      } else if (code === "local login disabled" || code === "dev login disabled") {
        setError("Local login is disabled. Sign in with Entra ID.");
      } else {
        setError("Sign-in failed. Check the email and password and try again.");
      }
      return;
    }
    window.location.assign(next);
  }

  return (
    <div className="login">
      <div className="panel">
        <div className="brand" style={{ marginBottom: 18 }}>
          <div className="mark">PG</div>
          <div>
            <strong>PRIVGATE</strong>
            <span>Elevation control plane</span>
          </div>
        </div>
        <p className="lede" style={{ marginBottom: 18 }}>
          {continueSetup
            ? "Sign in to finish initial setup."
            : "Sign in with a portal administrator account. Standard users never receive a stored admin password."}
        </p>
        {local ? (
          <form className="stack" onSubmit={onSubmit}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              minLength={10}
            />
            {error ? <p className="err">{error}</p> : null}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : null}
        {entra ? (
          <a
            className="primary"
            href="/api/auth/entra"
            style={{
              display: "inline-block",
              textAlign: "center",
              padding: "10px 12px",
              background: local ? "var(--surface-2, var(--bg-2))" : "var(--amber)",
              color: local ? "var(--ink)" : "var(--primary-ink)",
              marginTop: local ? 12 : 0,
              border: "1px solid var(--line)",
            }}
          >
            Sign in with Entra ID
          </a>
        ) : null}
        {!local && !entra ? (
          <p className="err">No sign-in method is available. Complete setup or connect Entra ID.</p>
        ) : null}
        {!local && error ? <p className="err">{error}</p> : null}
      </div>
    </div>
  );
}

export function LoginClient(props: { entra: boolean; local: boolean; continueSetup: boolean }) {
  return (
    <Suspense>
      <LoginForm {...props} />
    </Suspense>
  );
}
