#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-inatur-synk}"
REGION="${REGION:-europe-north1}"
RUN_SA="${RUN_SA:-inatur-synk-runner}"
SCHEDULER_SA="${SCHEDULER_SA:-inatur-synk-scheduler}"

if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Project $PROJECT_ID already exists and is accessible"
else
  if ! gcloud projects create "$PROJECT_ID" --name="$PROJECT_ID"; then
    echo "Could not create project $PROJECT_ID. The ID may be taken globally or inaccessible." >&2
    echo "Try PROJECT_ID=inatur-synk-carlerik or inspect the project in Google Cloud Console." >&2
    exit 1
  fi
fi

gcloud config set project "$PROJECT_ID"

if ! gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' | grep -q True; then
  echo "Billing is not enabled for $PROJECT_ID." >&2
  echo "Link billing, then re-run this script:" >&2
  echo "  gcloud billing projects link $PROJECT_ID --billing-account <BILLING_ACCOUNT_ID>" >&2
  exit 1
fi

gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

gcloud firestore databases create \
  --database="(default)" \
  --location="$REGION" || true

gcloud iam service-accounts create "$RUN_SA" \
  --display-name="Inatur sync Cloud Run runtime" || true

gcloud iam service-accounts create "$SCHEDULER_SA" \
  --display-name="Inatur sync scheduler invoker" || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
