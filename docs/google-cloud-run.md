# Google Cloud Run drift

Denne løsningen kjører samme synk som lokal CLI, men med Firestore som state store for `cookies.json` og `.session-token.txt`.

## Oppsett

Bruk Google-kontoen `carlerik@gmail.com` og prosjektet `inatur-synk`.

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/setup-inatur-synk.sh
```

Hvis scriptet stopper fordi billing ikke er koblet:

```bash
gcloud billing accounts list
gcloud billing projects link inatur-synk --billing-account <BILLING_ACCOUNT_ID>
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/setup-inatur-synk.sh
```

## Secrets

Opprett secrets uten å skrive verdiene til terminal-logg:

```bash
printf '%s' "$INATUR_USER" | gcloud secrets create INATUR_USER --data-file=-
printf '%s' "$INATUR_PASSWORD" | gcloud secrets create INATUR_PASSWORD --data-file=-
printf '%s' "$AIRBNB_ICAL_URL" | gcloud secrets create AIRBNB_ICAL_URL --data-file=-
```

Ved rotasjon:

```bash
printf '%s' "$INATUR_PASSWORD" | gcloud secrets versions add INATUR_PASSWORD --data-file=-
```

`deploy-inatur-synk.sh` binder disse til Cloud Run med `--set-secrets`.

## Deploy

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/deploy-inatur-synk.sh
```

## Seed Firestore state

Kjør dette etter at lokale cookies er gyldige:

```bash
GOOGLE_CLOUD_PROJECT=inatur-synk ./scripts/gcloud/seed-firestore-state.js
```

State lagres i:

```text
inaturSyncState/holmevann
```

## Manuell test

Sjekk først at tjenesten svarer uten å starte synken:

```bash
gcloud run services proxy inatur-synk --region europe-north1
curl --noproxy '*' http://localhost:8080/_healthz
```

Forventet svar:

```text
ok
```

`/healthz` kan stoppes av Google-fronten i enkelte Cloud Run/proxy-kombinasjoner. Bruk derfor `/_healthz` for manuell verifisering.

Når helsesjekken fungerer og du faktisk vil kjøre synken:

```bash
SERVICE_URL="$(gcloud run services describe inatur-synk --region europe-north1 --format='value(status.url)')"
curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$SERVICE_URL/cron"
```

Hvis lokal bruker ikke har invoker-tilgang, bruk proxy:

```bash
gcloud run services proxy inatur-synk --region europe-north1
curl -X POST http://localhost:8080/cron
```

## Scheduler hvert 5. minutt

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 SCHEDULER_LOCATION=europe-west1 ./scripts/gcloud/create-scheduler-inatur-synk.sh
```

Manuell scheduler-trigger:

```bash
PROJECT_ID=inatur-synk SCHEDULER_LOCATION=europe-west1 ./scripts/gcloud/trigger-inatur-synk.sh
```

Pause/resume:

```bash
gcloud scheduler jobs pause inatur-synk-every-5-minutes --location europe-west1
gcloud scheduler jobs resume inatur-synk-every-5-minutes --location europe-west1
```

## Logger

```bash
gcloud run services logs read inatur-synk --region europe-north1 --limit 100
```

Loggene skal ikke inneholde cookie-verdier eller passord.

## Rollback

```bash
gcloud run revisions list --service inatur-synk --region europe-north1
gcloud run services update-traffic inatur-synk --region europe-north1 --to-revisions REVISION=100
```

## Kostnadskontroll

Sett et budget alert på prosjektet, for eksempel NOK 10/mnd. Forventet bruk med `*/5 * * * *` er lav nok til å treffe gratisnivåene ved normal kjøretid.
