import { compareVersions, sanitizeClientVersion } from "./client-version";

/**
 * Self-update domain logic — pure, network-free, fully unit-testable.
 *
 * Versioning discipline (starts now):
 *  - 3-segment versions only (0.2.1, 0.2.13). No build metadata in tags.
 *  - OFFICIAL channel: GitHub releases with prerelease = false.
 *  - NIGHTLY channel: every release including prereleases; nightlies are
 *    published as PRERELEASES, so this channel sees them first.
 *  - Release assets follow packaging/build.sh naming:
 *      PrivGate-Console-<v>-win-x64.msi / .exe
 *      PrivGate-Console-<v>-macos-{x64|arm64}.pkg
 *      privgate-console_<v>_amd64.deb
 *    plus a sha256sums.txt covering all artifacts of that release.
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
 * Numeric core of a tag ("v0.2.13", "0.2.1"). Returns null for non-version
 * tags so label-only releases never win a channel pick.
 */
export function tagVersion(tag: unknown): string | null {
  const raw = String(tag ?? "").trim();
  const match = /^v?(\d+\.\d+(\.\d+)?)([.-].*)?$/i.exec(raw);
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
          { re: /^PrivGate-Console-(\d+\.\d+\.\d+)-win-x64\.msi$/, prefer: 0 },
          { re: /^PrivGate-Console-(\d+\.\d+\.\d+)-win-x64\.exe$/, prefer: 1 },
        ]
      : platform === "macos"
        ? [{ re: new RegExp(`^PrivGate-Console-(\\d+\\.\\d+\\.\\d+)-macos-${arch}\\.pkg$`) }]
        : [{ re: /^privgate-console_(\d+\.\d+\.\d+)_amd64\.deb$/ }];

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
    .map((release) => ({ release, version: tagVersion(release.tag_name) }))
    .filter((row): row is { release: GitHubRelease; version: string } => row.version !== null);

  // Highest version first; on equal numbers the prerelease wins for nightly
  // (the nightly rebuild of the same base version is the fresher artifact).
  rows.sort((a, b) => {
    const byVersion = compareVersions(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    return Number(b.release.prerelease === true) - Number(a.release.prerelease === true);
  });

  for (const row of rows) {
    const matched = matchPlatformAsset(row.release, platform, arch);
    if (!matched) continue;
    const assets = Array.isArray(row.release.assets) ? row.release.assets.map(asAsset).filter(Boolean) : [];
    const sums = assets.find((asset) => String(asset!.name) === "sha256sums.txt");
    return {
      release: row.release,
      candidate: {
        version: row.version,
        channel: opts.channel,
        assetName: String(matched.asset.name),
        url: String(matched.asset.browser_download_url),
        sumsUrl: sums ? String(sums.browser_download_url) : null,
        releaseUrl: typeof row.release.html_url === "string" ? row.release.html_url : "",
        prerelease: row.release.prerelease === true,
      },
    };
  }
  return null;
}

/** True when the candidate is strictly newer than the installed console. */
export function isUpdateAvailable(candidateVersion: string, installedVersion: string): boolean {
  return compareVersions(candidateVersion, installedVersion) > 0;
}
