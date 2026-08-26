import { can, getSession } from "@/lib/auth";
import { advertisedUrls, listenConfig } from "@/lib/listen";
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

  return (
    <>
      <div className="top">
        <div>
          <h1>Network</h1>
          <p className="lede">
            Ports used by the management console and Windows broker connections.
          </p>
        </div>
      </div>

      <div className="grid cards" style={{ marginBottom: 20 }}>
        <div className="panel stack" style={{ padding: 18 }}>
          <strong>Management console</strong>
          <p className="lede" style={{ fontSize: 13 }}>
            The port administrators use to open this console in a browser.
          </p>
          <div className="mono" style={{ fontSize: 22, margin: "8px 0" }}>{cfg.webPort}</div>
          <p className="lede" style={{ fontSize: 12, margin: 0 }}>
            Default: 3000
          </p>
        </div>
        <div className="panel stack" style={{ padding: 18 }}>
          <strong>Broker connection</strong>
          <p className="lede" style={{ fontSize: 13 }}>
            The port enrolled PCs connect to for elevation requests and status.
          </p>
          <div className="mono" style={{ fontSize: 22, margin: "8px 0" }}>{cfg.agentPort}</div>
          <p className="lede" style={{ fontSize: 12, margin: 0 }}>
            {cfg.splitPorts ? "Separate from management port" : "Same as management port"}
          </p>
        </div>
      </div>

      <div className="panel stack" style={{ padding: 18, marginBottom: 16 }}>
        <strong>How to change ports</strong>
        <p className="lede" style={{ fontSize: 13, margin: 0 }}>
          Ports are set when PrivGate starts. To change them, stop the service, update the port
          values in the PrivGate configuration file, and restart. Windows packaged installs add
          inbound firewall rules for both ports automatically.
        </p>
      </div>

      <div className="panel stack" style={{ padding: 18 }}>
        <strong>Opening the console from another computer</strong>
        <p className="lede" style={{ fontSize: 13 }}>
          Use any of these addresses in a browser on another machine on the same network.
        </p>
        <ul className="lede" style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
          {consoleUrls.map((url) => (
            <li key={url}>
              <span className="mono">{url}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
