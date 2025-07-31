# inatur-scripts

## Hvordan bruke skriptene
For å bruke skriptene må du sette miljøvariablene i `.env`:
```
INATUR_USER="foo@protonbar.com"
INATUR_PASSWORD="edga*HVFcorona"
INATUR_AKTIVTILBYDER="39a4b03b97f009e9" 
```

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
