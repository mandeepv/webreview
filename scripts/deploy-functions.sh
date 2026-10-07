#!/usr/bin/env bash
# Deploys the edge functions ONLY from a committed, pushed commit whose CI is
# fully green (spec work item 7). The integration and database tests need
# Docker and run in CI, so "green on GitHub" is the bar, not a local run.
#
#   scripts/deploy-functions.sh dodo-webhook resume   # deploy exactly these
#
# Names are REQUIRED (review 2026-10-07, B-8). There used to be an "all
# seven" default, and it included mint-handoff — whose deploy IS the go-live
# of the sign-in links (OPS_RUNBOOK §8.9) and must wait for app 1.3.0 — while
# the runbook said "deploy with scripts/deploy-functions.sh" with no names.
# Naming mint-handoff asks for a second, explicit confirmation.
#
# Order still matters (MANUAL_STEPS §8.6–§8.7): apply migrations and set
# FUNNEL_PROXY_SECRET BEFORE deploying functions that need them.
#
# Every function it deploys is recorded in DEPLOY_LOG.md (date, project,
# function, commit) the moment its deploy succeeds — Supabase keeps a version
# number per function but not which code it was. Commit the log afterwards;
# it is the one file allowed to be uncommitted when this script starts.
set -euo pipefail
cd "$(dirname "$0")/.."

KNOWN=(capture-email create-checkout dodo-webhook winback-sweep unsubscribe resume mint-handoff)
REQUIRED_CHECKS=(site functions backend e2e)
DEV_REF=<DEV_PROJECT_REF>
PROD_REF=<PROD_PROJECT_REF>

fail() { echo "✗ $*" >&2; exit 1; }

if [ $# -eq 0 ]; then
  echo "Usage: scripts/deploy-functions.sh <function> [<function> …]" >&2
  echo "Functions: ${KNOWN[*]}" >&2
  echo "Name each one. mint-handoff turns the live site's sign-in links on: only once app 1.3.0 is live." >&2
  exit 2
fi
FUNCS=("$@")
for fn in "${FUNCS[@]}"; do
  [[ " ${KNOWN[*]} " == *" $fn "* ]] || fail "Unknown function '$fn'. Known: ${KNOWN[*]}"
done

# Homebrew git first: /usr/bin/git stops on the Xcode licence prompt on this Mac.
GIT=$(command -v /opt/homebrew/bin/git || command -v git)
export PATH="$(dirname "$GIT"):$PATH"

# 1. Nothing uncommitted — what is deployed must be exactly a tested commit.
LOG=DEPLOY_LOG.md
"$GIT" diff --quiet -- . ":!$LOG" && "$GIT" diff --cached --quiet -- . ":!$LOG" || fail "Uncommitted changes. Commit and push first."

# 2. The commit is on GitHub.
SHA=$("$GIT" rev-parse HEAD)
"$GIT" fetch -q origin
"$GIT" branch -r --contains "$SHA" | grep -q . || fail "HEAD ($SHA) is not pushed. Push it and let CI run."

# 3. Every required CI job passed on this exact commit.
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
CHECKS=$(gh api "repos/$REPO/commits/$SHA/check-runs?per_page=100" \
  --jq '.check_runs[] | "\(.name)=\(.status)/\(.conclusion)"')
for name in "${REQUIRED_CHECKS[@]}"; do
  line=$(echo "$CHECKS" | grep "^$name=" | head -1 || true)
  [ -n "$line" ] || fail "CI job '$name' has not run on $SHA."
  [ "$line" = "$name=completed/success" ] || fail "CI job '$name' is not green on $SHA ($line)."
done
echo "✓ CI green on ${SHA:0:7} (${REQUIRED_CHECKS[*]})"

# 4. Unit tests here too — cheap, and catches a broken local toolchain.
npm run --silent test:functions >/dev/null || fail "Unit tests failed locally."

# 5. Confirm the target. A prod deploy aimed at dev (or the reverse) is the
#    classic silent failure. The CLI records the link in linked-project.json;
#    the plain project-ref file older docs mention is no longer written
#    (the app's scripts/backup-prod.sh reads the same file). Fail closed:
#    an unreadable or unknown ref is refused, never deployed to.
LINKED=supabase/.temp/linked-project.json
[ -f "$LINKED" ] || fail "$LINKED not found — the CLI is not linked. Run: supabase link --project-ref $DEV_REF"
REF=$(sed -n 's/.*"ref"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$LINKED")
case "$REF" in
  "$DEV_REF") LABEL="DEV (kinderwell-dev)"; WORD="deploy" ;;
  "$PROD_REF") LABEL="PRODUCTION (kinderwell)"; WORD="deploy production" ;;
  *) fail "Linked to an unknown project ('${REF:-unreadable}'). Refusing to deploy." ;;
esac

if [[ " ${FUNCS[*]} " == *" mint-handoff "* ]]; then
  echo "⚠ mint-handoff switches the sign-in links on for every buyer: the welcome page's Paste"
  echo "  handoff and the email's \"Open Kinderwell\". Deploy it only once app v1.3.0 is live in"
  echo "  the App Store (or to dev for the one end-to-end handoff test while no ads run)."
  read -r -p "Type 'mint-handoff' to include it: " confirm
  [ "$confirm" = "mint-handoff" ] || fail "Cancelled."
fi

echo "Deploy ${FUNCS[*]} to $LABEL?"
read -r -p "Type '$WORD' to continue: " answer
[ "$answer" = "$WORD" ] || fail "Cancelled."

for fn in "${FUNCS[@]}"; do
  supabase functions deploy "$fn" --no-verify-jwt
  # Recorded only once its deploy succeeded, so a run that fails halfway
  # still leaves an exact record of what did go out.
  echo "| $(date -u +%Y-%m-%dT%H:%MZ) | ${LABEL%% *} | $fn | ${SHA:0:7} |" >> "$LOG"
done
echo "✓ Deployed ${FUNCS[*]} from ${SHA:0:7} to $LABEL. Now run the MANUAL_STEPS §7 checks for what changed."
echo "✓ Recorded in $LOG — commit it: git add $LOG && git commit -m \"deploy: ${FUNCS[*]} → ${LABEL%% *}\" && git push"
