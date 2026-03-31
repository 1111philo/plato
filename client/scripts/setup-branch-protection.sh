#!/usr/bin/env bash
# Sets up branch protection rules for the main branch.
# Requires: gh CLI authenticated with admin access to the repo.
#
# Usage: ./scripts/setup-branch-protection.sh [OWNER/REPO]
# Example: ./scripts/setup-branch-protection.sh 1111philo/learn

set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

echo "Configuring branch protection for main on ${REPO}..."

gh api -X PUT "repos/${REPO}/branches/main/protection" \
  --input - << 'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["staging-rc", "release"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

echo ""
echo "Branch protection configured for main on ${REPO}."
echo ""
echo "Rules applied:"
echo "  - Pull requests required (1 approval minimum)"
echo "  - Stale reviews dismissed on new pushes"
echo "  - Status checks required (staging-rc, release)"
echo "  - Force pushes and deletions blocked"
echo ""
echo "NOTE: By convention, main only accepts PRs from the staging branch."
echo "      This is not enforced by GitHub but is documented in CONTRIBUTING.md."
