# inatur-scripts

## Hvordan bruke skriptene
For å bruke skriptene må du sette miljøvariablene i `.env`:
```
INATUR_USER="foo@protonbar.com"
INATUR_PASSWORD="edga*HVFcorona"
INATUR_AKTIVTILBYDER="39a4b03b97f009e9" 
AIRBNB_ICAL_URL="https://www.airbnb.no/calendar/ical/....ics?s=..."
INATUR_SELLER_ID="63ee193639a4b03b97f009e9"
INATUR_NODE_ID="63ee3bc2d0440d29d6c7ef45"
INATUR_CARD_ID="63ee3ba9d0440d29d6c7ef44"
INATUR_AVAILABILITY_ICAL_URL="https://www.inatur.no/api/external/v1/sales-pages/63ee3bc2d0440d29d6c7ef45/products/63ee3ba9d0440d29d6c7ef44/availability/ical"
```

`AIRBNB_ICAL_URL` inneholder en hemmelig token fra Airbnb og skal ikke committes. Hvis den ikke er satt,
bruker `sync-airbnb-inatur.js` kalender-URL-en for Holmevann som fallback.

## Skriptene som er inkludert

### kommende-opphold.sh

#### Anonymous mode
Med og uten anonyme data
```
./kommende-opphold.sh --anon
Ankomstdato: 28.07.2025 - Avreisedato: 01.08.2025
Ankomstdato: 01.08.2025 - Avreisedato: 03.08.2025
Ankomstdato: 13.08.2025 - Avreisedato: 17.08.2025
Ankomstdato: 19.08.2025 - Avreisedato: 22.08.2025
```

### ledige-dager.sh
```
 ./ledige-dager.sh 27-7-2025 20-09-2025
"3/8/2025"
"5/8/2025"
"6/8/2025"
"7/8/2025"
"8/8/2025"
"9/8/2025"
"10/8/2025"
"11/8/2025"
"12/8/2025"
"17/8/2025"
"18/8/2025"
```

### sync-airbnb-inatur.js

Synkroniserer enveis fra Airbnb iCal til Inatur ved å opprette sperrer i `kort[].antall.perioder`.
Skriptet sletter eller erstatter bare sperrer som selv er merket med `[airbnb-inatur-sync]` i kommentaren.
Manuelle Inatur-sperrer uten denne markøren blir stående.

Kjør først uten `--publish`; det er forhåndsvisning og skriver ikke til Inatur:

```
./sync-airbnb-inatur.js
```

Skriptet laster `.env` selv og bruker `./cookie-store` til å validere/friske opp sesjonen. For Inatur sin
redigeringsflyt leser det også hele `cookies.json`, fordi web2/rollebytte krever flere cookies enn den korte
`INATUR_COOKIE`-eksporten.

Forhåndsvisning skriver en diff, for eksempel:

```
Forhandsvisning: ingen endringer blir lagret eller publisert.
vil slette sperring 24.10.2026 -> 25.10.2026 ([airbnb-inatur-sync] uid=...)
vil legge til sperring 20.10.2026 -> 21.10.2026 ([airbnb-inatur-sync] uid=...)
```

Airbnb-oppføringer med `SUMMARY:Airbnb (Not available)` ignoreres som standard, siden de typisk kommer fra
Airbnb-regler som bookingvindu. Bruk `--include-airbnb-unavailable` hvis slike blokker også skal synkes.

Publisering krever eksplisitt `--publish`. CSRF-token hentes automatisk fra redigeringssiden:

```
./sync-airbnb-inatur.js --publish
```

For offline-test av diffen kan du bruke lokale filer:

```
./sync-airbnb-inatur.js \
  --from-file test/fixtures/airbnb-basic.ics \
  --offer-file test/fixtures/inatur-offer-basic.json
```

Etter publisering kan Inatur sin iCal-eksport brukes som sanity check:

```
curl --silent --show-error "$INATUR_AVAILABILITY_ICAL_URL" | head -40
```

### cookie-store
bash script med innebygd test-suite som håndterer innhenting av cookie, oppfriskning av sesjoner, m.m.
Som sluttbruker trenger du ikke tenke direkte på det, men kan brukes sammen med direnv for å sørge for
veldig smoothe opplevelser :)

```
 ./cookie-store

USAGE: ./cookie-store <option> [argument]
  where <option> is one of

    export              Prints the INATUR_COOKIE as an export statement for "eval"
    invalidate          OK if < 6h old cookie, else exit status of 1
    persist <cookie>    Will persist the session cookie
    delete              Force delete. Typical on a 401
    refresh             refresh the session cookie
    self-test           Run built-in tests
```

#### Eksempler på kald innhenting av token, varm oppfriskning, validering
```
❯ time ./cookie-store refresh

real    0m6,197s
user    0m1,237s
sys     0m0,627s

❯ time ./cookie-store refresh

real    0m0,926s
user    0m0,696s
sys     0m0,326s

❯ time ./cookie-store validate

real    0m0,014s
user    0m0,000s
sys     0m0,015s
```
