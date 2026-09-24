#!/usr/bin/env bash
# Run from the repo root before every push / before making the repo public.
# Fails if anything that must not ship is present. See docs/UAT-DEPLOYMENT.md.
#
# What it READS: only the files git tracks, plus new files git would let you add (untracked but
# not ignored). Never the working tree at large, so a git-ignored file such as .env is never
# opened, whichever `grep` is on the PATH (DECISIONS #96). It also calls the real grep binary by
# path: a shell function or alias called grep (some environments wrap it, and bash inherits
# exported functions) cannot change what is read.
#
# What it PRINTS: file:line only, never the matched text, and it writes no match to disk. A real
# secret it finds must not end up in a terminal, a transcript or a CI log.
#
# A grep that errors is a FAIL, not a pass: a check that could not run has not checked anything.
set -u
cd "$(dirname "$0")/.."
fail=0

GREP=$(type -P grep) || { echo "FAIL  no grep binary on PATH"; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "FAIL  not inside a git work tree (this script scans what git tracks)"; exit 1; }

# Files allowed to *mention* these terms (policy and decision docs): skipped by every check,
# matched by directory name (anywhere in the path) or by file name.
skipped() { # path
  case "/$1" in
    */node_modules/*|*/.venv/*|*/dist/*|*/.git/*|*/screenshots/*|*/DB/*|*/admin/*|*/Kiro/*) return 0 ;;
  esac
  case "${1##*/}" in
    UAT-DEPLOYMENT.md|DECISIONS.md|KANBAN.md|HANDOFF.md|prepush-check.sh|GAPS.md|ARCHITECTURE.md|SUBMISSION.md) return 0 ;;
  esac
  return 1
}

# Paths allowed to mention Vercel, for the Vercel check ONLY (they are still scanned by every other
# check). Whole-file on purpose, narrower than loosening the pattern: app/main.py carries the UAT
# frontend's origin in its CORS allowlist, docs/PORTABILITY.md documents where each piece is hosted.
VERCEL_ALLOWED=(app/main.py docs/PORTABILITY.md)

files=()
while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue          # tracked but deleted in the working tree
  skipped "$f" && continue
  files+=("$f")
done < <(git ls-files -z --cached --others --exclude-standard)

# scan PATTERN FILE... -> prints file:line for each match, NEVER the matched text.
# Exit status is grep's own: 0 matches, 1 none, 2 error.
scan() {
  local pattern=$1 rc
  shift
  "$GREP" -HIEn -e "$pattern" -- "$@" 2>/dev/null | cut -d: -f1,2
  rc=${PIPESTATUS[0]}
  return "$rc"
}

# Same, but drops matches whose line contains localhost (for the hardcoded-API-URL check).
scan_not_localhost() {
  local pattern=$1 rc
  shift
  "$GREP" -HIEn -e "$pattern" -- "$@" 2>/dev/null | "$GREP" -v 'localhost' | cut -d: -f1,2
  rc=${PIPESTATUS[0]}
  return "$rc"
}

# report LABEL HITS ERRORED: one ok/FAIL line, and at most five file:line hits under a FAIL.
report() {
  local label=$1 hits=$2 errored=$3 n
  if [ "$errored" -ne 0 ]; then
    echo "FAIL  $label (grep failed, so this check could not run)"; fail=1
  elif [ -n "$hits" ]; then
    n=$(printf '%s\n' "$hits" | wc -l | tr -d ' ')
    echo "FAIL  $label"
    printf '%s\n' "$hits" | head -5 | sed 's/^/        /'
    [ "$n" -gt 5 ] && echo "        ... and $((n - 5)) more"
    fail=1
  else
    echo "ok    $label"
  fi
}

# run_scan SCANNER PATTERN FILE... -> sets $hits and $errored. Batches the file list so a large
# repo cannot exceed the argument-length limit.
run_scan() {
  local scanner=$1 pattern=$2 out rc i=0 chunk=150
  shift 2
  local list=("$@") n=$#
  hits=""; errored=0
  while [ "$i" -lt "$n" ]; do
    out=$("$scanner" "$pattern" "${list[@]:$i:$chunk}"); rc=$?
    [ "$rc" -ge 2 ] && errored=1
    [ -n "$out" ] && hits="${hits:+$hits$'\n'}$out"
    i=$((i + chunk))
  done
}

# check LABEL PATTERN [ALLOWED_PATH ...]: fail if PATTERN matches in any scanned file. The optional
# paths may match for THIS check only.
check() {
  local label=$1 pattern=$2 f p keep list=()
  shift 2
  for f in ${files[@]+"${files[@]}"}; do
    keep=1
    for p in "$@"; do [ "$f" = "$p" ] && keep=0; done
    [ "$keep" -eq 1 ] && list+=("$f")
  done
  run_scan scan "$pattern" ${list[@]+"${list[@]}"}
  report "$label" "$hits" "$errored"
}

check "no Vercel URLs or project links"  'vercel\.app|\.vercel\.' "${VERCEL_ALLOWED[@]}"
check "no Supabase references"           'supabase'

webfiles=()
for f in ${files[@]+"${files[@]}"}; do
  case "$f" in web/src/*|web/index.html) webfiles+=("$f") ;; esac
done
run_scan scan_not_localhost 'https?://[^"'"'"' `]*/api' ${webfiles[@]+"${webfiles[@]}"}
report "no hardcoded absolute API URLs in web/ (use same-origin /api)" "$hits" "$errored"

check "no secret-looking assignments"    '(API_KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*=[^ ]+'

# Existence checks, not content scans: a local dev machine legitimately has these files, they
# just must never be tracked. Unchanged by DECISIONS #96.
for f in .env web/.env; do
  [ -e "$f" ] && { echo "FAIL  $f exists (must be git-ignored, never committed)"; fail=1; }
done
[ -e .vercel ] || [ -e web/.vercel ] && { echo "FAIL  .vercel/ folder present (delete before push)"; fail=1; }

[ $fail -eq 0 ] && echo "All checks passed." || { echo "Pre-push check FAILED."; exit 1; }
