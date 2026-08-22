"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const next = useSearchParams().get("next") || "/dashboard";
  const [email, setEmail] = useState("ada@contoso.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const entra = process.env.NEXT_PUBLIC_AUTH_MODE === "entra";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: password || undefined }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setBusy(false);
      const code = body.error || "";
      if (code === "disabled") {
        setError("This portal account is disabled. Contact a Master Admin.");
      } else if (code === "sso required") {
        setError("This account uses Entra SSO. Use the Entra sign-in link.");
      } else if (code === "dev login disabled") {
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
          Admins approve allowlists and JIT windows. Standard users never receive a stored admin password.
        </p>
        {entra ? (
          <a
            className="primary"
            href="/api/auth/entra"
            style={{ display: "inline-block", padding: "10px 12px", background: "var(--amber)", color: "var(--primary-ink)" }}
          >
            Sign in with Entra ID
          </a>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            <label htmlFor="email">Admin UPN</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <label htmlFor="password">Password <span className="lede" style={{ fontSize: 11 }}>(leave blank for demo accounts)</span></label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="optional in development"
            />
            {error ? <p className="err">{error}</p> : null}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Enter console"}
            </button>
            <a className="primary" href="/api/auth/entra" style={{ display: "inline-block", textAlign: "center", padding: "10px 12px", background: "var(--surface-2)", color: "var(--primary-ink)" }}>
              Sign in with Entra ID instead
            </a>
          </form>
        )}
        <p className="lede" style={{ marginTop: 16, fontSize: 12 }}>
          Demo: ada@contoso.test (Master Admin). Riley is a standard AD user — portal login not allowed.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
