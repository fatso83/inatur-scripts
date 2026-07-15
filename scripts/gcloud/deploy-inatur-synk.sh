#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-inatur-synk}"
REGION="${REGION:-europe-north1}"
SERVICE_NAME="${SERVICE_NAME:-inatur-synk}"
RUN_SA="${RUN_SA:-inatur-synk-runner}"
SCHEDULER_SA="${SCHEDULER_SA:-inatur-synk-scheduler}"

gcloud config set project "$PROJECT_ID"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --service-account "$RUN_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --no-allow-unauthenticated \
  --max-instances 1 \
  --concurrency 1 \
  --timeout 300 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "RUNTIME=google-cloud,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,FIRESTORE_DATABASE_ID=(default),INATUR_STATE_COLLECTION=inaturSyncState,INATUR_STATE_DOCUMENT=holmevann,SYNC_LOCK_TTL_SECONDS=240,INATUR_AKTIVTILBYDER=63ee193639a4b03b97f009e9,INATUR_SELLER_ID=63ee193639a4b03b97f009e9,INATUR_NODE_ID=63ee3bc2d0440d29d6c7ef45,INATUR_CARD_ID=63ee3ba9d0440d29d6c7ef44,INATUR_AVAILABILITY_ICAL_URL=https://www.inatur.no/api/external/v1/sales-pages/63ee3bc2d0440d29d6c7ef45/products/63ee3ba9d0440d29d6c7ef44/availability/ical" \
  --set-secrets "INATUR_USER=INATUR_USER:latest,INATUR_PASSWORD=INATUR_PASSWORD:latest,AIRBNB_ICAL_URL=AIRBNB_ICAL_URL:latest"

gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --region "$REGION" \
  --member="serviceAccount:$SCHEDULER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
