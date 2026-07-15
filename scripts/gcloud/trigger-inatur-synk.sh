#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-inatur-synk}"
SCHEDULER_LOCATION="${SCHEDULER_LOCATION:-europe-west1}"
SCHEDULER_NAME="${SCHEDULER_NAME:-inatur-synk-every-5-minutes}"

gcloud config set project "$PROJECT_ID"
gcloud scheduler jobs run "$SCHEDULER_NAME" --location "$SCHEDULER_LOCATION"
