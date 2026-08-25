import { describe, expect, it } from "vitest";
import {
  isUpdateAvailable,
  normalizeChannel,
  parseSha256Sums,
  pickLatestForPlatform,
  platformKey,
  tagVersion,
  type GitHubRelease,
} from "./self-update";

function release(overrides: Partial<GitHubRelease> & { tag: string; assets?: unknown[] }): GitHubRelease {
  const { tag, ...rest } = overrides;
  return {
    tag_name: tag,
    prerelease: false,
    draft: false,
    html_url: `https://github.com/bouatom/privgate/releases/tag/${tag}`,
    assets: rest.assets ?? [],
    ...rest,
  };
}

function asset(name: string) {
  return { name, browser_download_url: `https://example.test/${name}` };
}

const SUMS_ASSET = asset("sha256sums.txt");
const INSTALLED = "0.2.1";

const RELEASE_FIXTURE = (): unknown[] => [
  release({ tag: "0.2.13", prerelease: true, assets: [asset("PrivGate-Console-0.2.13-win-x64.msi"), SUMS_ASSET] }),
  release({ tag: "v0.2.12", assets: [asset("PrivGate-Console-0.2.12-win-x64.msi"), asset("PrivGate-Console-0.2.12-win-x64.exe"), SUMS_ASSET] }),
  release({ tag: "0.2.10", draft: true, assets: [asset("PrivGate-Console-0.2.10-win-x64.msi")] }),
  release({ tag: "0.1.9", assets: [SUMS_ASSET] }), // no compatible asset on purpose
];

describe("channel selection", () => {
  it("official ignores prereleases and drafts even when they are newer", () => {
    const picked = pickLatestForPlatform(RELEASE_FIXTURE(), {
      channel: "official",
      platform: "windows",
      arch: "x64",
    });
    expect(picked?.candidate.version).toBe("0.2.12");
    expect(picked?.candidate.prerelease).toBe(false);
  });

  it("nightly takes prereleases into account and picks the highest", () => {
    const picked = pickLatestForPlatform(RELEASE_FIXTURE(), {
      channel: "nightly",
      platform: "windows",
      arch: "x64",
    });
    expect(picked?.candidate.version).toBe("0.2.13");
    expect(picked?.candidate.prerelease).toBe(true);
    expect(picked?.release.draft).not.toBe(true);
  });

  it("never selects a draft on either channel", () => {
    const onlyDraft = [release({ tag: "9.9.9", draft: true, assets: [asset("PrivGate-Console-9.9.9-win-x64.msi")] })];
    for (const channel of ["official", "nightly"] as const) {
      expect(pickLatestForPlatform(onlyDraft, { channel, platform: "windows" })).toBeNull();
    }
  });

  it("skips releases without a matching platform asset instead of failing the whole check", () => {
    const picked = pickLatestForPlatform(
      [
        release({ tag: "0.3.0", assets: [] }),
        release({ tag: "0.2.5", assets: [asset("PrivGate-Console-0.2.5-win-x64.exe"), SUMS_ASSET] }),
      ],
      { channel: "official", platform: "windows" },
    );
    expect(picked?.candidate.version).toBe("0.2.5");
    expect(picked?.candidate.assetName).toBe("PrivGate-Console-0.2.5-win-x64.exe");
  });

  it("prefers .msi over .exe for Windows", () => {
    const picked = pickLatestForPlatform(RELEASE_FIXTURE(), { channel: "official", platform: "windows" });
    expect(picked?.candidate.assetName).toBe("PrivGate-Console-0.2.12-win-x64.msi");
  });

  it("matches macOS pkg per architecture", () => {
    const releases = [
      release({
        tag: "0.4.0",
        assets: [
          asset("PrivGate-Console-0.4.0-macos-arm64.pkg"),
          asset("PrivGate-Console-0.4.0-macos-x64.pkg"),
          SUMS_ASSET,
        ],
      }),
    ];
    expect(pickLatestForPlatform(releases, { channel: "official", platform: "macos", arch: "arm64" })?.candidate.assetName).toBe(
      "PrivGate-Console-0.4.0-macos-arm64.pkg",
    );
    expect(pickLatestForPlatform(releases, { channel: "official", platform: "macos", arch: "x64" })?.candidate.version).toBe("0.4.0");
  });

  it("matches the Linux deb naming", () => {
    const releases = [release({ tag: "0.2.7", assets: [asset("privgate-console_0.2.7_amd64.deb"), SUMS_ASSET] })];
    const picked = pickLatestForPlatform(releases, { channel: "official", platform: "linux" });
    expect(picked?.candidate.assetName).toBe("privgate-console_0.2.7_amd64.deb");
    expect(picked?.candidate.sumsUrl).toContain("sha256sums.txt");
  });

  it("returns null for an unsupported host platform", () => {
    expect(platformKey("freebsd")).toBeNull();
    expect(pickLatestForPlatform(RELEASE_FIXTURE(), { channel: "official", platform: "freebsd" as never })).toBeNull();
  });
});

describe("availability comparison", () => {
  it("is only true when strictly newer than the installed console", () => {
    expect(isUpdateAvailable("0.2.13", INSTALLED)).toBe(true);
    expect(isUpdateAvailable("0.2.1", INSTALLED)).toBe(false);
    expect(isUpdateAvailable("0.2.0", INSTALLED)).toBe(false);
  });

  it("fires for installed 0.2.1 once a 0.2.2 nightly tag exists (post-bump scenario)", () => {
    expect(tagVersion("v0.2.2-n.202608250429")).toBe("0.2.2");
    expect(isUpdateAvailable("0.2.2", INSTALLED)).toBe(true);
  });
});

describe("nightly-shaped prerelease tags (vX.Y.Z-n.TS)", () => {
  const NIGHTLY = release({
    tag: "v0.2.2-n.202608250429",
    prerelease: true,
    // Asset names read the PLAIN version — matchPlatformAsset only accepts
    // strict x.y.z filenames, so the -n.TS suffix must never reach them.
    assets: [asset("PrivGate-Console-0.2.2-win-x64.msi"), asset("PrivGate-Console-0.2.2-win-x64.exe"), SUMS_ASSET],
  });
  const OFFICIAL_0_2_1 = release({ tag: "v0.2.1", assets: [asset("PrivGate-Console-0.2.1-win-x64.msi"), SUMS_ASSET] });

  it("official channel ignores the nightly and stays on the last official build", () => {
    const picked = pickLatestForPlatform([NIGHTLY, OFFICIAL_0_2_1], { channel: "official", platform: "windows" });
    expect(picked?.candidate.version).toBe("0.2.1");
    expect(picked?.candidate.prerelease).toBe(false);
  });

  it("nightly channel prefers the prerelease and reports the plain core version", () => {
    const picked = pickLatestForPlatform([NIGHTLY, OFFICIAL_0_2_1], { channel: "nightly", platform: "windows" });
    expect(picked?.candidate.version).toBe("0.2.2");
    expect(picked?.candidate.prerelease).toBe(true);
    expect(picked?.candidate.assetName).toBe("PrivGate-Console-0.2.2-win-x64.msi");
    expect(picked?.candidate.sumsUrl).toContain("sha256sums.txt");
    expect(isUpdateAvailable(picked!.candidate.version, INSTALLED)).toBe(true);
  });

  it("nightly rebuild of the same base version beats the official release at equal numbers", () => {
    const officialSameBase = release({ tag: "v0.2.2", assets: [asset("PrivGate-Console-0.2.2-win-x64.msi")] });
    const picked = pickLatestForPlatform([officialSameBase, NIGHTLY], { channel: "nightly", platform: "windows" });
    expect(picked?.release.tag_name).toBe("v0.2.2-n.202608250429");
  });
});

describe("tag + helpers", () => {
  it("parses numeric tags and rejects label-only ones", () => {
    expect(tagVersion("v1.2.3")).toBe("1.2.3");
    expect(tagVersion("0.2.13")).toBe("0.2.13");
    expect(tagVersion("nightly-build")).toBeNull();
    expect(tagVersion(undefined)).toBeNull();
  });

  it("normalizes channels defensively", () => {
    expect(normalizeChannel("nightly")).toBe("nightly");
    expect(normalizeChannel("official")).toBe("official");
    expect(normalizeChannel(undefined)).toBe("official");
    expect(normalizeChannel("hacker")).toBe("official");
  });

  it("parses sha256sums.txt entries (comments, CRLF, binary marker)", () => {
    const sums = parseSha256Sums(
      [
        "# comment line",
        "",
        "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789 *PrivGate-Console-0.2.13-win-x64.msi\r",
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef  privgate-console_0.2.13_amd64.deb",
        "garbage-line-without-hash",
      ].join("\n"),
    );
    expect(sums.get("PrivGate-Console-0.2.13-win-x64.msi")).toBe(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    );
    expect(sums.get("privgate-console_0.2.13_amd64.deb")?.startsWith("1234567890")).toBe(true);
    expect(sums.size).toBe(2);
  });
});
