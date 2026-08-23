import { can, getSession } from "@/lib/auth";
import {
  advertisedUrls,
  consoleEnvHint,
  listenConfig,
} from "@/lib/listen";
import { Forbidden } from "../../forbidden";

export default async function NetworkPage() {
  const session = await getSession();
  if (
    !can(session, "portal.users.manage") &&
    !can(session, "integrations.view") &&
    !can(session, "integrations.manage") &&
    !can(session, "devices.enroll")
  ) {
    return <Forbidden />;
  }
  const cfg = listenConfig();
  const consoleUrls = advertisedUrls(cfg.webPort, cfg.bind);
  const agentUrls = advertisedUrls(cfg.agentPort, cfg.bind);
  const envFile = consoleEnvHint();

  return (
    <>
      <div className="top">
        <div>
          <h1>Network</h1>
          <p className="lede">
            The management console and Windows brokers can use different TCP ports. Other computers
            reach this host when the bind address is <span className="mono">0.0.0.0</span> (all
            interfaces), not loopback.
          </p>
        </div>
      </div>

      <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
        <strong>Current listen settings</strong>
        <table>
          <tbody>
            <tr>
              <td>Bind address</td>
              <td className="mono">{cfg.bind}</td>
            </tr>
            <tr>
              <td>Management web port</td>
              <td className="mono">{cfg.webPort}</td>
            </tr>
            <tr>
              <td>Client / broker port</td>
              <td className="mono">{cfg.agentPort}</td>
            </tr>
            <tr>
              <td>Split ports</td>
              <td>{cfg.splitPorts ? "Yes — brokers must use the client port" : "No — same port as the console"}</td>
            </tr>
          </tbody>
        </table>
        <p className="lede" style={{ fontSize: 13, margin: 0 }}>
          Change these in <span className="mono">{envFile}</span> (or a repo <span className="mono">.env</span> for{" "}
          <span className="mono">npm run dev</span>), then restart the process. Windows packaged installs add inbound
          firewall rules for both ports automatically.
        </p>
      </div>

      <div className="grid cards">
        <div className="panel stack" style={{ padding: 18 }}>
          <strong>Open the console from another computer</strong>
          <p className="lede" style={{ fontSize: 13 }}>
            Browsers use the management port. On this machine you can still use loopback.
          </p>
          <ul className="lede" style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
            {consoleUrls.map((url) => (
              <li key={url}>
                <span className="mono">{url}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel stack" style={{ padding: 18 }}>
          <strong>Control plane URL for enrolled PCs</strong>
          <p className="lede" style={{ fontSize: 13 }}>
            Paste one of these into <strong>Devices</strong> when downloading an installer. Brokers call{" "}
            <span className="mono">/api/agent/*</span> on this port only.
          </p>
          <ul className="lede" style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
            {agentUrls.map((url) => (
              <li key={url}>
                <span className="mono">{url}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel stack" style={{ padding: 18, marginTop: 16 }}>
        <strong>Environment variables</strong>
        <table>
          <tbody>
            <tr>
              <td className="mono">PRIVGATE_BIND</td>
              <td>
                Listen address. <span className="mono">0.0.0.0</span> or <span className="mono">::</span> for LAN;{" "}
                <span className="mono">127.0.0.1</span> for this host only. Legacy alias: <span className="mono">HOSTNAME</span>.
              </td>
            </tr>
            <tr>
              <td className="mono">PRIVGATE_WEB_PORT</td>
              <td>Management UI. Legacy alias: <span className="mono">PORT</span>. Default 3000.</td>
            </tr>
            <tr>
              <td className="mono">PRIVGATE_AGENT_PORT</td>
              <td>Broker API. Default 3001. Set equal to the web port to share a single listener.</td>
            </tr>
            <tr>
              <td className="mono">PRIVGATE_PUBLIC_ORIGIN</td>
              <td>Canonical console URL for Entra redirects (use this behind a reverse proxy).</td>
            </tr>
            <tr>
              <td className="mono">PRIVGATE_AGENT_ORIGIN</td>
              <td>Canonical broker URL when it is not “same host, agent port”.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
