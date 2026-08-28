import { describe, expect, it } from "vitest";
import {
  deviceDetail,
  listDeviceSummaries,
  registerOrReuseDevice,
  resetDbForTests,
  setDeviceLastIp,
} from "./index";

describe("device IP capture & serialization", () => {
  it("persists and serializes last_ip through the summaries and detail endpoints", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    const registered = registerOrReuseDevice(db, "pc-01", "hybrid", "test-secret");
    expect(registered.reused).toBe(false);

    // No IP captured yet.
    const before = listDeviceSummaries(db).find((d) => d.id === registered.id)!;
    expect(before.lastIp).toBe("");
    expect(deviceDetail(db, registered.id)!.lastIp).toBe("");

    // Capture an IP (as the WS handshake would).
    setDeviceLastIp(db, registered.id, "10.0.0.5");

    const after = listDeviceSummaries(db).find((d) => d.id === registered.id)!;
    expect(after.lastIp).toBe("10.0.0.5");
    expect(deviceDetail(db, registered.id)!.lastIp).toBe("10.0.0.5");
  });

  it("ignores a blank IP so it never erases a known address", () => {
    const db = resetDbForTests(":memory:", { seedDemo: false });
    const registered = registerOrReuseDevice(db, "pc-02", "hybrid", "test-secret");
    setDeviceLastIp(db, registered.id, "192.168.1.10");
    setDeviceLastIp(db, registered.id, "");
    expect(listDeviceSummaries(db).find((d) => d.id === registered.id)!.lastIp).toBe("192.168.1.10");
  });
});
