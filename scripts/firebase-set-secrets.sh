#!/usr/bin/env bash
#
# Push the backend's secrets into Firebase Secret Manager for the Cloud Functions migration.
#
# Prereqs (do these first):
#   1. firebase login
#   2. a Firebase project on the Blaze plan, with its id in .firebaserc (replace the placeholder)
#   3. run this from the REPO ROOT, with backend/.env.local present on this machine
#
# Values are read from backend/.env on YOUR machine and piped straight into Firebase — they
# are never printed to the terminal. The secret NAMES below must stay in sync with the
# `secrets` arrays in backend/src/functions.ts and backend/src/scheduled.ts.
#
set -euo pipefail

ENV_FILE="backend/.env.local"

SECRETS=(
  MONGO_URI
  JWT_SECRET
  FRONTEND_URL
  ADMIN_REGISTRATION_SECRET
  PRINTED_PHOTOS_PRODUCT_ID
  SHOPIFY_STORE_DOMAIN
  SHOPIFY_ACCESS_TOKEN
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION
  AWS_S3_BUCKET
  SHIPROCKET_API_EMAIL
  SHIPROCKET_API_PASSWORD
  OPENAI_API_KEY
  DELHIVERY_API_KEY
  DELHIVERY_API_URL
  DELHIVERY_PICKUP_LOCATION
  META_ACCESS_TOKEN
  META_AD_ACCOUNT_ID
)

command -v firebase >/dev/null || { echo "firebase CLI not found — npm i -g firebase-tools"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (run from the repo root)"; exit 1; }

# Read the first "KEY=..." line; strip KEY=, a trailing CR, and one layer of surrounding quotes.
get_val() {
  grep -m1 -E "^$1=" "$ENV_FILE" \
    | sed -E "s/^$1=//; s/\r$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}

for key in "${SECRETS[@]}"; do
  val="$(get_val "$key" || true)"
  if [ -z "${val}" ]; then
    echo "⚠  $key not found in $ENV_FILE — enter it when prompted:"
    firebase functions:secrets:set "$key"
  else
    printf '%s' "$val" | firebase functions:secrets:set "$key" --data-file - >/dev/null
    echo "✓ set $key"
  fi
done

echo
echo "All secrets set. Next:"
echo "  firebase deploy --only functions      # deploys 'api' + scheduled 'roasRecompute'"
echo "  # the deploy prints the api function URL; verify with:  curl <that-url>/api/health"
echo "  # then set the frontend's VITE_API_URL to <that-url> and redeploy it."
