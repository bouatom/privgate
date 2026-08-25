#!/usr/bin/env bash
# Classify every GitHub release of a repo as OFFICIAL or NIGHTLY.
#
# Codifies the marker contract documented in docs/releasing.md and consumed
# by src/lib/self-update.ts (channel filtering on the prerelease flag):
#
#   official : tag matches ^v?[0-9]+\.[0-9]+\.[0-9]+$          AND prerelease=false
#              (dotnet-desktop.yml tag push; published with --latest)
#   nightly  : tag matches ^v[0-9]+\.[0-9]+\.[0-9]+-n\.[0-9]+$ AND prerelease=true
#              (nightly.yml cron/dispatch; published --prerelease --latest=false)
#   other    : everything else — branch-build prereleases (tag "nightly"),
#              hand-made tags, and rule violations (plain tag marked
#              prerelease, or nightly-shaped tag published non-prerelease),
#              plus drafts (invisible to unauthenticated callers anyway).
#
# Output: one TSV line per release -> tag<TAB>verdict<TAB>title
# Deps: gh only (verdict logic runs in gh's embedded --jq; standalone jq unused).
set -euo pipefail

usage() {
  echo "usage: $0 [OWNER/REPO]" >&2
  echo "  Without an argument the repo is derived from the 'origin' git remote." >&2
}

repo="${1:-}"
if [[ -z "$repo" ]]; then
  url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ -z "$url" ]]; then
    usage
    echo "error: no OWNER/REPO given and no 'origin' remote found" >&2
    exit 1
  fi
  # Handles https://github.com/o/r.git and git@github.com:o/r.git alike.
  repo="${url#*github.com[:/]}"
  repo="${repo%.git}"
  repo="${repo%/}"
fi
if [[ ! "$repo" =~ ^[^/]+/[^/]+$ ]]; then
  echo "error: expected OWNER/REPO, got '${repo}'" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI ('gh') is required but not installed" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated; run 'gh auth login' (or export GH_TOKEN)" >&2
  exit 1
fi

# Verdict rules mirror self-update.ts: the official channel keeps only
# non-prereleases whose tag parses as a plain x.y.z; nightlies are
# prereleases tagged vX.Y.Z-n.<digits>.
jq_program='
  def verdict:
    if .draft == true then "draft"
    elif .prerelease == false and (.tag_name | test("^v?[0-9]+\\.[0-9]+\\.[0-9]+$")) then "official"
    elif .prerelease == true and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+-n\\.[0-9]+$")) then "nightly"
    else "other"
    end;
  .[]
  | [(.tag_name // "(no tag)"), verdict, (.name // "")]
  | @tsv
'

if ! out="$(gh api --paginate "repos/${repo}/releases" --jq "$jq_program" 2>&1)"; then
  echo "error: GitHub API request failed for ${repo}: ${out}" >&2
  exit 1
fi

if [[ -z "$out" ]]; then
  echo "no releases found for ${repo}" >&2
  exit 0
fi

printf '%s\n' "$out"
