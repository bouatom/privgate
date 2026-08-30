import { can, getSession } from "@/lib/auth";
import { lanUrls, listenConfig } from "@/lib/listen";
import { currentServerApplyStatus } from "@/lib/server-settings-state";
import { Forbidden } from "../../forbidden";
import { NetworkClient } from "./network-client";

export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const session = await getSession();
  if (!can(session, "portal.users.manage")) {
    return <Forbidden />;
  }
  const cfg = listenConfig();

  return (
    <>
      <div className="top">
        <div>
          <h1>Server &amp; network</h1>
          <p className="lede">
            Where the console listens and the port enrolled PCs connect to. Changes restart the
            console and roll back automatically if it does not come back healthy.
          </p>
        </div>
      </div>

      <NetworkClient
        canManage
        bind={cfg.bind}
        webPort={cfg.webPort}
        agentPort={cfg.agentPort}
        lanUrls={lanUrls(cfg.webPort, cfg.bind)}
        initialApply={currentServerApplyStatus()}
      />

      <div className="panel stack" style={{ padding: 18 }}>
        <strong>Opening the console from another computer</strong>
        <p className="lede" style={{ fontSize: 13 }}>
          Use one of these LAN addresses in a browser on another machine on the same network.
          The address <span className="mono">127.0.0.1</span> only works in a browser on this machine itself.
        </p>
        <ul className="lede" style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
          {lanUrls(cfg.webPort, cfg.bind).map((url) => (
            <li key={url}>
              <span className="mono">{url}</span>
            </li>
          ))}
          {lanUrls(cfg.webPort, cfg.bind).length === 1 &&
          /127\.0\.0\.1/.test(lanUrls(cfg.webPort, cfg.bind)[0]) ? (
            <li className="lede">
              The console is bound to loopback, so it is not reachable from other machines yet.
              Switch to “All interfaces” above and apply to make it reachable on the LAN.
            </li>
          ) : null}
        </ul>
      </div>
    </>
  );
}