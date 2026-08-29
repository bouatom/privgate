import { compareVersions, sanitizeClientVersion, compareFullVersions } from "./client-version";

/**
 * Self-update domain logic — pure, network-free, fully unit-testable.
 *
 * Versioning discipline:
 *  - Official channel: 3-segment versions (0.3.2, 0.3.3, 0.3.4) from non-prerelease GitHub releases.
 *  - Nightly channel: 4-segment versions (0.3.2.1, 0.3.2.2, 0.3.2.3) from prerelease GitHub releases.
 *    Nightlies are published as PRERELEASES so this channel sees them first.
 *  - Asset naming:
 *      Official: PrivGate-Console-<x.y.z>-win-x64.msi / .exe
 *      Nightly:  PrivGate-Console-<x.y.z.n>-win-x64.msi / .exe
 *      Plus sha256sums.txt covering all artifacts of that release.
 */

export const GITHUB_REPO = "bouatom/privgate";
export const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;

export type UpdateChannel = "official" | "nightly";
export type PlatformKey = "windows" | "macos" | "linux";

/** Shape of the fields we consume from the GitHub /releases payload. */
export type GitHubRelease = {
  tag_name?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

export type GitHubAsset = { name?: unknown; browser_download_url?: unknown };

export type UpdateCandidate = {
  version: string;
  channel: UpdateChannel;
  assetName: string;
  url: string;
  /** sha256sums.txt asset URL; null when the release does not ship one. */
  sumsUrl: string | null;
  releaseUrl: string;
  prerelease: boolean;
};

export function normalizeChannel(raw: unknown): UpdateChannel {
  return raw === "nightly" ? "nightly" : "official";
}

export function platformKey(platform: string = process.platform): PlatformKey | null {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return null;
}

function archToken(arch: string): "x64" | "arm64" | null {
  if (arch === "x64" || arch === "arm64") return arch;
  return null;
}

/**
 * Numeric core of a tag ("v0.3.2", "v0.3.2.1", "0.3.2"). Returns null for non-version
 * tags so label-only releases never win a channel pick.
 * Accepts both 3-segment (official) and 4-segment (nightly) versions.
 */
export function tagVersion(tag: unknown): string | null {
  const raw = String(tag ?? "").trim();
  // Match vX.Y.Z or vX.Y.Z.N (optional 4th segment for nightlies)
  const match = /^v?(\d+\.\d+\.\d+(?:\.\d+)?)(?:[.-].*)?$/i.exec(raw);
  if (!match) return null;
  return sanitizeClientVersion(match[1]);
}

function asAsset(asset: unknown): GitHubAsset | null {
  if (!asset || typeof asset !== "object") return null;
  const record = asset as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.browser_download_url !== "string") return null;
  return { name: record.name, browser_download_url: record.browser_download_url };
}

/** Parse "<hex>[ *]<name>" lines; hex lower-cased, comments and blanks skipped. */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(trimmed);
    if (!match) continue;
    out.set(match[2].trim(), match[1].toLowerCase());
  }
  return out;
}

interface AssetMatch {
  asset: GitHubAsset;
  version: string;
}

function matchPlatformAsset(release: GitHubRelease, platform: PlatformKey, arch: string): AssetMatch | null {
  const assets = Array.isArray(release.assets) ? release.assets.map(asAsset).filter(Boolean) : [];
  const patterns: Array<{ re: RegExp; prefer?: number }> =
    platform === "windows"
      ? [
          // NSIS stop-all is stronger than MSI ServiceControl; MSI 1603 on
          // locked files left prod on 0.3.1 while the EXE path can finish.
          { re: /^PrivGate-Console-(\d+\.\d+\.\d+(?:\.\d+)?)-win-x64\.exe$/, prefer: 0 },
          { re: /^PrivGate-Console-(\d+\.\d+\.\d+(?:\.\d+)?)-win-x64\.msi$/, prefer: 1 },
        ]
      : platform === "macos"
        ? [{ re: new RegExp(`^PrivGate-Console-(\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?)-macos-${arch}\\.pkg$`) }]
        : [{ re: /^privgate-console_(\d+\.\d+\.\d+(?:\.\d+)?)_amd64\.deb$/ }];

  let best: { match: AssetMatch; prefer: number } | null = null;
  for (const asset of assets) {
    const name = String(asset!.name);
    for (const { re, prefer = 0 } of patterns) {
      const found = re.exec(name);
      if (!found) continue;
      const entry = { match: { asset: asset!, version: sanitizeClientVersion(found[1]) }, prefer };
      if (!best || entry.prefer < best.prefer) best = entry;
    }
  }
  return best?.match ?? null;
}

/**
 * Newest release for the channel that carries an installable asset for the
 * running platform/arch. Drafts are invisible to unauthenticated API calls but
 * are still excluded defensively.
 *
 * Per-release version resolution: the tag first ("v0.3.2.n.1");
 * when the tag is not version-shaped, the version stamped into the platform
 * asset filename decides. Releases carrying neither stay invisible.
 */
export function pickLatestForPlatform(
  releases: unknown,
  opts: {
    channel: UpdateChannel;
    platform?: PlatformKey;
    arch?: string;
  },
): { candidate: UpdateCandidate; release: GitHubRelease } | null {
  const platform = opts.platform ?? platformKey();
  if (!platform) return null;
  const arch = opts.arch ?? archToken(process.arch) ?? "x64";

  const rows = (Array.isArray(releases) ? releases : [])
    .map((release) => (release && typeof release === "object" ? (release as GitHubRelease) : null))
    .filter((release): release is GitHubRelease => Boolean(release))
    .filter((release) => release.draft !== true)
    .filter((release) => opts.channel === "nightly" || release.prerelease !== true)
    .map((release) => {
      const matched = matchPlatformAsset(release, platform, arch);
      const version = tagVersion(release.tag_name) ?? matched?.version ?? null;
      return { release, matched, version };
    })
    .filter(
      (row): row is { release: GitHubRelease; matched: AssetMatch; version: string } =>
        row.version !== null && row.matched !== null,
    );

  // Sort by version: highest first. For nightly channel, use full version comparison
  // (includes nightly build counter). For official, use base version comparison.
  rows.sort((a, b) => {
    let byVersion: number;
    if (opts.channel === "nightly") {
      byVersion = compareFullVersions(b.version, a.version);
    } else {
      byVersion = compareVersions(b.version, a.version);
    }
    if (byVersion !== 0) return byVersion;
    // For nightly, prerelease (true) wins for equal base (newer nightly rebuild)
    return Number(b.release.prerelease === true) - Number(a.release.prerelease === true);
  });

  const best = rows[0];
  if (!best || !best.matched) return null;

  const assets = Array.isArray(best.release.assets) ? best.release.assets.map(asAsset).filter(Boolean) : [];
  const sums = assets.find((asset) => String(asset!.name) === "sha256sums.txt");
  return {
    release: best.release,
    candidate: {
      version: best.version,
      channel: opts.channel,
      assetName: String(best.matched.asset.name),
      url: String(best.matched.asset.browser_download_url),
      sumsUrl: sums ? String(sums.browser_download_url) : null,
      releaseUrl: typeof best.release.html_url === "string" ? best.release.html_url : "",
      prerelease: best.release.prerelease === true,
    },
  };
}

/** True when the candidate is strictly newer than the installed console. */
export function isUpdateAvailable(candidateVersion: string, installedVersion: string, channel: UpdateChannel = "official"): boolean {
  if (channel === "nightly") {
    return compareFullVersions(candidateVersion, installedVersion) > 0;
  }
  return compareVersions(candidateVersion, installedVersion) > 0;
}
