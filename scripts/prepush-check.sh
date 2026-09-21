#!/usr/bin/env bash
# Run from the repo root before every push / before making the repo public.
# Fails if anything that must not ship is present. See docs/UAT-DEPLOYMENT.md.
set -u
cd "$(dirname "$0")/.."
fail=0

# Files allowed to *mention* these terms (policy and decision docs).
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=dist --exclude-dir=.git
          --exclude-dir=screenshots --exclude-dir=DB --exclude-dir=admin --exclude-dir=Kiro
          --exclude=UAT-DEPLOYMENT.md --exclude=DECISIONS.md --exclude=KANBAN.md --exclude=HANDOFF.md
          --exclude=prepush-check.sh --exclude=GAPS.md --exclude=ARCHITECTURE.md --exclude=SUBMISSION.md)

check() { # label, pattern
  if grep -rIEn "${EXCLUDES[@]}" -e "$2" . >/tmp/prepush-hits.txt 2>/dev/null && [ -s /tmp/prepush-hits.txt ]; then
    echo "FAIL  $1"; sed 's/^/        /' /tmp/prepush-hits.txt | head -5; fail=1
  else
    echo "ok    $1"
  fi
}

check "no Vercel URLs or project links"  'vercel\.app|\.vercel\.'
check "no Supabase references"           'supabase'
if grep -rIEn 'https?://[^"'"'"' `]*/api' web/src web/index.html 2>/dev/null | grep -v 'localhost'; then
  echo "FAIL  hardcoded absolute API URL in web/ (use same-origin /api)"; fail=1
else
  echo "ok    no hardcoded absolute API URLs in web/"
fi
check "no secret-looking assignments"    '(API_KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*=[^ ]+'

for f in .env web/.env; do
  [ -e "$f" ] && { echo "FAIL  $f exists (must be git-ignored, never committed)"; fail=1; }
done
[ -e .vercel ] || [ -e web/.vercel ] && { echo "FAIL  .vercel/ folder present (delete before push)"; fail=1; }

[ $fail -eq 0 ] && echo "All checks passed." || { echo "Pre-push check FAILED."; exit 1; }
