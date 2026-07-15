#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-inatur-synk}"
REGION="${REGION:-europe-north1}"
SCHEDULER_LOCATION="${SCHEDULER_LOCATION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-inatur-synk}"
SCHEDULER_NAME="${SCHEDULER_NAME:-inatur-synk-every-5-minutes}"
SCHEDULER_SA="${SCHEDULER_SA:-inatur-synk-scheduler}"

gcloud config set project "$PROJECT_ID"
SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

gcloud scheduler jobs create http "$SCHEDULER_NAME" \
  --location "$SCHEDULER_LOCATION" \
  --schedule "*/5 * * * *" \
  --uri "$SERVICE_URL/cron" \
  --http-method POST \
  --oidc-service-account-email "$SCHEDULER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --oidc-token-audience "$SERVICE_URL"
