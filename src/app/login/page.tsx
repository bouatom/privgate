"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/dashboard";
  const [email, setEmail] = useState("ada@contoso.test");
  const [error, setError] = useState("");
  const entra = process.env.NEXT_PUBLIC_AUTH_MODE === "entra";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      setError("That account is not an Approver or PolicyAdmin.");
      return;
    }
    router.push(next);
    router.refresh();
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
          <a className="primary" href="/api/auth/entra" style={{ display: "inline-block", padding: "10px 12px", background: "var(--amber)", color: "#1a1208" }}>
            Sign in with Entra ID
          </a>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            <label htmlFor="email">Admin UPN</label>
            <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            {error ? <p className="err">{error}</p> : null}
            <button className="primary" type="submit">Enter console</button>
          </form>
        )}
        <p className="lede" style={{ marginTop: 16, fontSize: 12 }}>
          Demo: ada@contoso.test (admin). Riley is a standard AD user and cannot sign in here.
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
