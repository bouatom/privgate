import { describe, expect, it, beforeEach } from "vitest";
import { resetRealtimeForTests, publishConsole, replayConsole, subscribeConsole, type ConsoleEvent } from "./bus";

describe("replayConsole (SSE replay buffer)", () => {
  beforeEach(() => {
    resetRealtimeForTests();
  });

  it("does not deliver anything before any publish", () => {
    const delivered: ConsoleEvent[] = [];
    replayConsole("requests", (event) => delivered.push(event));
    expect(delivered).toHaveLength(0);
  });

  it("replays buffered events for a topic to a fresh subscriber", () => {
    publishConsole("requests");
    publishConsole("requests");
    publishConsole("devices");

    const delivered: ConsoleEvent[] = [];
    replayConsole("requests", (event) => delivered.push(event));

    expect(delivered).toHaveLength(2);
    expect(delivered.every((e) => e.topic === "requests" && e.type === "mutate")).toBe(true);
  });

  it("does not leak other topics into a topic's replay", () => {
    publishConsole("jit");
    const delivered: ConsoleEvent[] = [];
    replayConsole("requests", (event) => delivered.push(event));
    expect(delivered).toHaveLength(0);
  });

  it("live subscribers still receive publishes directly", () => {
    const seen: ConsoleEvent[] = [];
    const unsubscribe = subscribeConsole((event) => seen.push(event));
    publishConsole("audit");
    unsubscribe();
    expect(seen).toHaveLength(1);
    expect(seen[0].topic).toBe("audit");
  });
});
