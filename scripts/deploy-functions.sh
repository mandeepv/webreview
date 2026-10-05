#!/usr/bin/env bash
# Deploys the edge functions ONLY from a committed, pushed commit whose CI is
# fully green (spec work item 7). The integration and database tests need
# Docker and run in CI, so "green on GitHub" is the bar, not a local run.
#
#   scripts/deploy-functions.sh                       # all six, to the linked project
#   scripts/deploy-functions.sh dodo-webhook resume   # just these
#
# Order still matters (MANUAL_STEPS §8.6–§8.7): apply migrations and set
# FUNNEL_PROXY_SECRET BEFORE deploying functions that need them.
set -euo pipefail
cd "$(dirname "$0")/.."

ALL=(capture-email create-checkout dodo-webhook winback-sweep unsubscribe resume)
if [ $# -eq 0 ]; then FUNCS=("${ALL[@]}"); else FUNCS=("$@"); fi
REQUIRED_CHECKS=(site functions backend e2e)

# Homebrew git first: /usr/bin/git stops on the Xcode licence prompt on this Mac.
GIT=$(command -v /opt/homebrew/bin/git || command -v git)
export PATH="$(dirname "$GIT"):$PATH"

fail() { echo "✗ $*" >&2; exit 1; }

# 1. Nothing uncommitted — what is deployed must be exactly a tested commit.
"$GIT" diff --quiet && "$GIT" diff --cached --quiet || fail "Uncommitted changes. Commit and push first."

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
#    classic silent failure.
REF=$(cat supabase/.temp/project-ref 2>/dev/null || echo "unknown — run: supabase link --project-ref <ref>")
case "$REF" in
  <DEV_PROJECT_REF>) LABEL="DEV (kinderwell-dev)" ;;
  <PROD_PROJECT_REF>) LABEL="PRODUCTION (kinderwell)" ;;
  *) LABEL="$REF" ;;
esac
echo "Deploy ${FUNCS[*]} to $LABEL?"
read -r -p "Type the word 'deploy' to continue: " answer
[ "$answer" = "deploy" ] || fail "Cancelled."

for fn in "${FUNCS[@]}"; do
  supabase functions deploy "$fn" --no-verify-jwt
done
echo "✓ Deployed ${FUNCS[*]} from ${SHA:0:7}. Now run the MANUAL_STEPS §7 checks for what changed."
