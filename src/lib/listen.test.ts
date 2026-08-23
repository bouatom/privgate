import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PORT,
  DEFAULT_BIND,
  DEFAULT_WEB_PORT,
  advertisedUrls,
  agentOriginFromWebOrigin,
  isLoopbackBind,
  isWildcardBind,
  listenConfig,
  parseListenPort,
} from "./listen";

describe("listenConfig", () => {
  it("binds all interfaces with split console and agent ports by default", () => {
    expect(listenConfig({})).toEqual({
      bind: DEFAULT_BIND,
      webPort: DEFAULT_WEB_PORT,
      agentPort: DEFAULT_AGENT_PORT,
      splitPorts: true,
    });
  });

  it("prefers PRIVGATE_BIND over the legacy HOSTNAME alias", () => {
    expect(
      listenConfig({ HOSTNAME: "127.0.0.1", PRIVGATE_BIND: "0.0.0.0" }).bind,
    ).toBe("0.0.0.0");
  });

  it("reads PRIVGATE_WEB_PORT ahead of PORT", () => {
    expect(listenConfig({ PORT: "80", PRIVGATE_WEB_PORT: "8443" }).webPort).toBe(8443);
  });

  it("can share a single port when the operator sets them equal", () => {
    const cfg = listenConfig({ PRIVGATE_WEB_PORT: "8080", PRIVGATE_AGENT_PORT: "8080" });
    expect(cfg.splitPorts).toBe(false);
    expect(cfg.webPort).toBe(8080);
  });

  it("rejects out-of-range ports", () => {
    expect(parseListenPort("0", 3000)).toBe(3000);
    expect(parseListenPort("70000", 3000)).toBe(3000);
    expect(parseListenPort("nope", 3000)).toBe(3000);
    expect(parseListenPort("443", 3000)).toBe(443);
  });
});

describe("agentOriginFromWebOrigin", () => {
  it("rewrites the console port to the agent port on the same host", () => {
    expect(agentOriginFromWebOrigin("http://192.168.1.10:3000", {})).toBe("http://192.168.1.10:3001");
  });

  it("leaves a reverse-proxy origin alone when the browser port is not the console port", () => {
    expect(agentOriginFromWebOrigin("https://privgate.contoso.test", {})).toBe("https://privgate.contoso.test");
  });

  it("honours PRIVGATE_AGENT_ORIGIN", () => {
    expect(
      agentOriginFromWebOrigin("http://192.168.1.10:3000", {
        PRIVGATE_AGENT_ORIGIN: "https://agents.contoso.test:8443/ignored",
      }),
    ).toBe("https://agents.contoso.test:8443");
  });

  it("does not rewrite when both ports are the same", () => {
    expect(
      agentOriginFromWebOrigin("http://192.168.1.10:3000", {
        PRIVGATE_WEB_PORT: "3000",
        PRIVGATE_AGENT_PORT: "3000",
      }),
    ).toBe("http://192.168.1.10:3000");
  });
});

describe("bind helpers", () => {
  it("treats loopback and wildcard distinctly", () => {
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
    expect(isWildcardBind("0.0.0.0")).toBe(true);
    expect(isWildcardBind("127.0.0.1")).toBe(false);
  });

  it("always includes loopback in advertised URLs", () => {
    expect(advertisedUrls(3000, "127.0.0.1")).toEqual(["http://127.0.0.1:3000"]);
    expect(advertisedUrls(3000, "0.0.0.0")).toContain("http://127.0.0.1:3000");
  });
});
