#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# pre-push-check.sh
# Run this before every git push. Verifies backend AND frontend build cleanly.
# Usage: bash pre-push-check.sh [commit-message]
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/admin"
MSG="${1:-chore: update}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}▶ $1${NC}"; }

# ── 1. Backend build ──────────────────────────────────────────────────────────
info "Backend: npm run build"
cd "$BACKEND"
if npm run build --silent 2>&1 | grep -E "error TS|SyntaxError|Cannot find" | grep -v "^>" ; then
  fail "Backend build failed — fix errors above before pushing."
fi
pass "Backend build OK"

# ── 2. Frontend TypeScript check ──────────────────────────────────────────────
info "Frontend: tsc --noEmit"
cd "$FRONTEND"
TS_ERRORS=$(node node_modules/typescript/bin/tsc --noEmit --skipLibCheck 2>&1 | grep "error TS" | grep -v "next.config" || true)
if [ -n "$TS_ERRORS" ]; then
  echo "$TS_ERRORS"
  fail "Frontend TypeScript errors found — fix above before pushing."
fi
pass "Frontend TypeScript OK"

# ── 3. Frontend ESLint (errors only, warnings allowed) ────────────────────────
info "Frontend: ESLint (errors only)"
LINT_ERRORS=$(node node_modules/eslint/bin/eslint.js src/ --format=json 2>/dev/null \
  | node -e "
      const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const errs=d.flatMap(f=>f.messages.filter(m=>m.severity===2).map(m=>f.filePath.split('/src/')[1]+':'+m.line+' '+m.message));
      if(errs.length){errs.forEach(e=>console.log(e));process.exit(1);}
    " || true)
if [ -n "$LINT_ERRORS" ]; then
  echo "$LINT_ERRORS"
  fail "Frontend ESLint errors found — fix above before pushing."
fi
pass "Frontend ESLint OK (0 errors)"

# ── 4. Push ───────────────────────────────────────────────────────────────────
info "All checks passed — pushing to GitHub"
cd "$ROOT"

# Sync with remote first
git fetch origin master
git pull --rebase origin master 2>/dev/null || true

# Stage everything, commit if there are changes, then push
git add -A
if git diff --cached --quiet; then
  info "Nothing to commit — just pushing"
else
  git commit -m "$MSG"
fi
git push origin master

pass "Pushed to GitHub ✅"
