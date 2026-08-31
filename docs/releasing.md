# Releasing the management console

How the console gets a version, what moves it, and — just as important —
what does **not** move it.

## Where a version comes from

```
package.json ──(branch build: CI reads it)──┐
refs/tags/vX.Y.Z ──(official tag build)─────┤→ PRIVGATE_VERSION env
nightly.yml computed patch increment ───────┘        │
                                                     ▼
                                       packaging/build.sh stamps version.json
                                                     │
                                                     ▼
                            runtime: manifest → PRIVGATE_VERSION → package.json
                                     (/api/healthz, self-update compare)
```

`packaging/build.sh` never invents a number: CI passes `PRIVGATE_VERSION`,
local runs default to the source tree's own `package.json` version.

## Tag discipline

### Official releases — the tag IS the version

Versioning is automatic and **tag-determined**. You never hand-edit
`package.json` to cut a release; the tag you push chooses the version.

1. Cut an **annotated** tag at the commit you want to ship and push it:
   ```bash
   git tag -a v0.2.3 -m "PrivGate Console 0.2.3"
   git push origin v0.2.3
   ```
   The tag name chooses the version — `v0.2.3` publishes `0.2.3`, a minor or
   major is chosen the same way (`v1.0.0` → `1.0.0`).
2. `.github/workflows/auto-version.yml` sees `refs/tags/v*` and syncs the
   source-of-truth metadata to the tag — `version.json`, `package.json`, and
   `package-lock.json` root version all become `X.Y.Z` — then commits that to
   `main` (`[skip ci]`, so it triggers no further builds). This keeps future
   branch builds and dev-mode resolution consistent with the released version.
3. `dotnet-desktop.yml` sees `refs/tags/v*`, derives the version from the tag,
   builds all installers, and publishes a **non-prerelease** release marked
   `--latest`.

The tag name is the release. There is no separate "promote" step and no manual
version-number editing anywhere.

### Nightlies — scheduled or dispatched, never tagged by hand

- `.github/workflows/nightly.yml` runs daily ~03:17 UTC and via
  `workflow_dispatch`.
- It computes the version as **patch increment of the highest exact `x.y.z`**
  found across remote tags *and* releases; its own previous `vX.Y.Z-n.TS`
  nightlies do not move the base.
- It publishes a **prerelease** with a collision-safe tag `vX.Y.Z-n.YYYYMMDDHHMM`
  while every user-visible string (filenames, title) reads plain `X.Y.Z`.

## How update channels consume this

| Channel | Sees | Ignores |
| --- | --- | --- |
| Official | non-prerelease releases only | every nightly, drafts |
| Nightly  | everything, prereleases first | drafts |

Both compare numerically per segment against the installed console's
`version.json`. A nightly `v0.2.2-n.TS` counts as `0.2.2`: equal to an official
`v0.2.2`, newer than an official `v0.2.1`. The official channel therefore only
ever offers real releases.

## One-command cut checklist

```bash
# 1. Dry-run the pipeline end-to-end without touching releases:
gh workflow run nightly.yml
gh run watch $(gh run list --workflow=nightly.yml --limit 1 --json databaseId --jq '.[0].databaseId')

# 2. If green, cut the official release:
#    (the tag name is the version; auto-version.yml syncs version.json + package.json)
git fetch origin && git tag -a vX.Y.Z origin/main && git push origin vX.Y.Z
```

Verify afterwards: the new GitHub Release is **not** marked pre-release, and
`sha256sums.txt` lists EXE + MSI + pkg + deb.

## What does NOT move the console version

**Branch pushes alone never change the shipped console version.** A push to
`main` produces installers stamped with whatever `package.json` says — if it was
not synced to a tag, they carry the old number and self-update will not offer
them to existing installs. The version only moves when one of these happens:

- you push an annotated `vX.Y.Z` tag (official release; `auto-version.yml`
  syncs `version.json` / `package.json` / `package-lock.json` to the tag),
- you dispatch/run `nightly.yml` (prerelease at base+patch).

## Classifying an existing release

The channel of a release is fully determined by two observable fields from
`GET /repos/{owner}/{repo}/releases`: `tag_name` and `prerelease`. The
`latest` flag is set at publish time (`--latest` for official, `--latest=false`
for nightlies) but is not exposed in the list payload; the observable proxy is
which tag `/releases/latest` resolves to — it must be the newest **official**.

| Tag shape | prerelease | latest (publish flag) | Verdict |
| --- | --- | --- | --- |
| `^v?\d+\.\d+\.\d+$` | `false` | `true` | **official** |
| `^v\d+\.\d+\.\d+-n\.\d+$` (`-n.YYYYMMDDHHMM`) | `true` | `false` | **nightly** |
| `^v?\d+\.\d+\.\d+$` but marked prerelease | `true` | any | anomaly — invisible to official, hijacks the nightly base version |
| nightly-shaped tag, published non-prerelease | `false` | any | anomaly — leaks into every official install; never do this |
| anything else (e.g. literal tag `nightly` from a branch build) | any | any | other — `self-update.ts` cannot parse the tag, so both channels ignore it |

One-liner listing with computed verdicts (uses gh's embedded jq; no jq binary needed):

```bash
gh api --paginate repos/bouatom/privgate/releases --jq '
  def verdict:
    if .draft == true then "draft"
    elif .prerelease == false and (.tag_name | test("^v?[0-9]+\\.[0-9]+\\.[0-9]+$")) then "official"
    elif .prerelease == true and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+-n\\.[0-9]+$")) then "nightly"
    else "other" end;
  .[] | [(.tag_name // "(no tag)"), verdict, (.name // "")] | @tsv'
```

Or run the wrapper: `scripts/classify-release.sh [OWNER/REPO]` (defaults to
origin), which prints `tag<TAB>verdict<TAB>title` per release.

Cross-check that "latest" still points at an official release:

```bash
gh api repos/bouatom/privgate/releases/latest --jq '.tag_name + " " + (.prerelease|tostring)'
```

Note: `self-update.ts`'s `tagVersion` is deliberately looser than this table
(it also accepts two-segment `x.y` tags and any `-`/`.` suffix as a base);
the table encodes what our two workflows actually emit.

## Rules of thumb

- Never hand-create `vX.Y.Z-n.TS` tags; the timestamp format is owned by
  `nightly.yml`, and its retention sweep deletes that shape after 30 days.
- Never publish a nightly as non-prerelease — that would leak it into every
  official-channel install.
- Asset filenames always use plain `x.y.z`; the self-updater's asset matching
  rejects anything else.
