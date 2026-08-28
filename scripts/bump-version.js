#!/usr/bin/env node
/**
 * Version bump script - increments patch version in package.json
 * and generates version.json for deployment.
 * Run via pre-commit or pre-push hook.
 */

const fs = require('fs');
const path = require('path');

const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');
const VERSION_JSON = path.join(__dirname, '..', 'version.json');

function bumpPatch(version) {
  const parts = version.split('.').map(Number);
  if (parts.length < 3) {
    throw new Error(`Invalid version format: ${version}`);
  }
  parts[2] += 1; // bump patch
  return parts.join('.');
}

function main() {
  // Read package.json
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const oldVersion = pkg.version;
  const newVersion = bumpPatch(pkg.version);
  
  // Update package.json
  pkg.version = newVersion;
  fs.writeFileSync(PACKAGE_JSON, JSON.stringify(pkg, null, 2) + '\n');
  
  // Generate version.json for deployment
  const versionInfo = {
    version: newVersion,
    buildTime: new Date().toISOString(),
    gitCommit: require('child_process')
      .execSync('git rev-parse --short HEAD', { encoding: 'utf8' })
      .trim(),
    buildTime: new Date().toISOString()
  };
  
  fs.writeFileSync(
    path.join(__dirname, '..', 'version.json'),
    JSON.stringify(versionInfo, null, 2)
  );
  
  console.log(`Version bumped: ${oldVersion} -> ${newVersion}`);
  console.log(`version.json written`);
  
  // Also update the client version constant for the agent
  // This will be embedded in the agent at build time
  console.log(`Version: ${versionInfo.version}`);
}

main();