"use client";

import { FormEvent, Suspense, useState } from "react";

const STEPS = ["Welcome", "Administrator", "Finish"] as const;

function SetupWizard({
  needsAdmin: initialNeedsAdmin,
  signedIn: initialSignedIn,
  webPort,
  agentPort,
  bind,
  consoleUrls,
  agentUrls,
}: {
  needsAdmin: boolean;
  signedIn: boolean;
  webPort: number;
  agentPort: number;
  bind: string;
  consoleUrls: string[];
  agentUrls: string[];
}) {
  const [needsAdmin, setNeedsAdmin] = useState(initialNeedsAdmin);
  const [signedIn, setSignedIn] = useState(initialSignedIn);
  const [step, setStep] = useState(!initialNeedsAdmin && initialSignedIn ? 2 : 0);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function go(next: number) {
    setError("");
    setStep(Math.max(0, Math.min(2, next)));
  }

  async function createAdmin(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/setup/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName, email, password }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Could not create the administrator account.");
      return;
    }
    setNeedsAdmin(false);
    setSignedIn(true);
    setMessage("Master Admin created. You are signed in.");
    go(2);
  }

  async function finish() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/setup/complete", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || "Could not finish setup.");
      return;
    }
    window.location.assign("/dashboard");
  }

  return (
    <div className="login">
      <div className="panel wizard">
        <div className="brand" style={{ marginBottom: 18 }}>
          <div className="mark">PG</div>
          <div>
            <strong>PRIVGATE</strong>
            <span>Initial setup</span>
          </div>
        </div>
        <div className="wizard-progress" aria-hidden>
          {STEPS.map((label, i) => (
            <span key={label} className={i <= step ? "on" : ""} title={label} />
          ))}
        </div>
        <p className="mono" style={{ margin: "0 0 12px", fontSize: 11, color: "var(--muted)" }}>
          {STEPS[step]} · {step + 1} of {STEPS.length}
        </p>

        {step === 0 ? (
          <div className="stack">
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.03em" }}>Welcome to PrivGate</h1>
            <p className="lede">
              This console keeps people as standard users. IT allowlists signed programs, approves a
              one-shot elevation, or opens a short just-in-time admin window. UAC stays on. Admin
              passwords are never stored on endpoints.
            </p>
            <ul className="lede" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Create a local Master Admin to sign in to this console.</li>
              <li>
                Later, under Configuration → Identity Sources, connect Entra ID, on-premises Active
                Directory, both, or neither. Each is optional and independent.
              </li>
              <li>Enroll each Windows PC from Devices after this wizard.</li>
            </ul>
            <div className="wizard-nav">
              <button className="primary" type="button" onClick={() => go(1)}>
                Get started
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          needsAdmin ? (
            <form className="stack" onSubmit={createAdmin}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Create the Master Admin</h2>
              <p className="lede">
                This local account signs in to the management portal. There is no demo user. Directory
                SSO is configured after setup, under Configuration.
              </p>
              <label htmlFor="name">Display name</label>
              <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label htmlFor="password">Password (at least 10 characters)</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                autoComplete="new-password"
              />
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={10}
                autoComplete="new-password"
              />
              {error ? <p className="err">{error}</p> : null}
              <div className="wizard-nav">
                <button className="ghost" type="button" onClick={() => go(0)}>
                  Back
                </button>
                <button className="primary" type="submit" disabled={busy}>
                  {busy ? "Creating…" : "Create administrator"}
                </button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <h2 style={{ margin: 0, fontSize: 18 }}>Administrator is ready</h2>
              <p className="lede">A Master Admin already exists for this console.</p>
              {!signedIn ? (
                <p className="lede">
                  <a href="/login?next=/setup" style={{ color: "var(--amber-2)" }}>
                    Sign in
                  </a>{" "}
                  to finish setup.
                </p>
              ) : null}
              <div className="wizard-nav">
                <button className="ghost" type="button" onClick={() => go(0)}>
                  Back
                </button>
                <button className="primary" type="button" onClick={() => go(2)} disabled={!signedIn}>
                  Continue
                </button>
              </div>
            </div>
          )
        ) : null}

        {step === 2 ? (
          <div className="stack">
            <h2 style={{ margin: 0, fontSize: 18 }}>You are ready</h2>
            <p className="lede">
              Sign in with the local Master Admin. Under Configuration → Identity Sources you can
              connect Entra ID for SSO, on-premises Active Directory for on-prem users, both
              (hybrid), or neither.
            </p>
            <ul className="lede" style={{ margin: 0, paddingLeft: 18 }}>
              <li>{`Management console (port ${webPort}${bind ? `, bind ${bind}` : ""}): ${consoleUrls[0]}`}</li>
              <li>{`Windows brokers call port ${agentPort}: ${agentUrls[0]}`}</li>
              <li>Enroll each PC from Devices and download that host’s installer.</li>
            </ul>
            {message ? <p className="ok">{message}</p> : null}
            {error ? <p className="err">{error}</p> : null}
            {!signedIn ? (
              <p className="lede">
                <a href="/login?next=/setup" style={{ color: "var(--amber-2)" }}>
                  Sign in
                </a>{" "}
                to finish setup.
              </p>
            ) : null}
            <div className="wizard-nav">
              <button className="ghost" type="button" onClick={() => go(1)}>
                Back
              </button>
              <button className="primary" type="button" disabled={busy || !signedIn} onClick={() => void finish()}>
                {busy ? "Saving…" : "Open the console"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SetupClient(props: {
  needsAdmin: boolean;
  signedIn: boolean;
  webPort: number;
  agentPort: number;
  bind: string;
  consoleUrls: string[];
  agentUrls: string[];
}) {
  return (
    <Suspense>
      <SetupWizard {...props} />
    </Suspense>
  );
}
