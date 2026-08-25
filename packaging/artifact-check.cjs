"use strict";

/**
 * Validates an unpacked PrivGate console payload before it replaces a running
 * installation. Used by scripts/update-server.sh, scripts/update-server.ps1
 * and packaging smoke tests: verify → stop → swap → start → health-check.
 *
 * Plain CommonJS on purpose — the updater runs it with the bundled node of the
 * installed console, which does not ship src/.
 */

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_FILES = [
  "host.cjs",
  "version.json",
  "listen.cjs",
  "listen-config.cjs",
  "graceful-shutdown.cjs",
  "write-env.cjs",
  "startup-validation.cjs",
  "artifact-check.cjs",
  "health-check.cjs",
  path.join("agent", "dist", "PrivGate.Agent.exe"),
];

function runtimeFile(platform = process.platform) {
  return platform === "win32" ? "node.exe" : path.join("bin", "node");
}

function requiredFiles(platform) {
  return [...REQUIRED_FILES, runtimeFile(platform)];
}

/**
 * Checks one unpacked app directory. Returns { ok, problems, checked } without
 * throwing so callers can print every problem at once.
 */
function checkArtifact(appDir, options = {}) {
  const platform = options.platform || process.platform;
  const problems = [];
  let checked = 0;

  if (!appDir || !fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
    return {
      ok: false,
      checked: 0,
      problems: [`not a directory: ${appDir || "(none)"}`],
    };
  }

  for (const relative of requiredFiles(platform)) {
    checked += 1;
    const abs = path.join(appDir, relative);
    if (!fs.existsSync(abs)) {
      problems.push(`missing file: ${relative}`);
    }
  }

  // The standalone build manifest is what listen.cjs loads at boot; catch a
  // half-copied .next directory before it takes a working install down.
  const manifest = path.join(appDir, ".next", "required-server-files.json");
  checked += 1;
  if (!fs.existsSync(manifest)) {
    problems.push(".next/required-server-files.json is missing (incomplete .next build?)");
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (!parsed || typeof parsed.config !== "object" || parsed.config == null) {
        problems.push("required-server-files.json has no config object");
      }
    } catch (err) {
      problems.push(`required-server-files.json is not valid JSON (${err.message})`);
    }
  }

  // The installed-version manifest is the runtime's single source of truth for
  // what is on disk (self-update compares it against GitHub releases). A
  // missing or malformed manifest would make a swapped install lie about its
  // version, so reject the payload outright.
  const versionManifest = path.join(appDir, "version.json");
  checked += 1;
  if (!fs.existsSync(versionManifest)) {
    problems.push("version.json is missing (build must stamp the payload version)");
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(versionManifest, "utf8"));
      const raw = typeof parsed?.version === "string" ? parsed.version.trim() : "";
      if (!/^v?\d+\.\d+\.\d+$/.test(raw)) {
        problems.push(`version.json has no x.y.z version (got "${raw}")`);
      }
    } catch (err) {
      problems.push(`version.json is not valid JSON (${err.message})`);
    }
  }

  const runtime = path.join(appDir, runtimeFile(platform));
  if (fs.existsSync(runtime) && platform !== "win32") {
    try {
      fs.accessSync(runtime, fs.constants.X_OK);
    } catch {
      problems.push(`${runtimeFile(platform)} is not executable`);
    }
  }

  return { ok: problems.length === 0, problems, checked };
}

function fromCli(argv = process.argv.slice(2)) {
  const dir = argv.find((arg) => !arg.startsWith("--"));
  const platformArg = argv.includes("--platform") ? argv[argv.indexOf("--platform") + 1] : undefined;
  const result = checkArtifact(dir, platformArg ? { platform: platformArg } : {});
  if (result.ok) {
    console.log(`artifact-ok ${dir} (${result.checked} checks passed)`);
    return 0;
  }
  console.error(`artifact-invalid ${dir || "(none)"}`);
  for (const problem of result.problems) console.error(`  - ${problem}`);
  return 1;
}

module.exports = { checkArtifact, requiredFiles, runtimeFile };

if (require.main === module) process.exit(fromCli());
