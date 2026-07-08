#!/bin/bash
# Printer ut noe slikt som dette:
#$ ./kommende-opphold.sh
#[
#  {
#    "when": "Ankomstdato: 15.06.2023 - Avreisedato: 18.06.2023",
#    "who": "Ola Hogan",
#    "phone": "+4798754321",
#    "email": "ola.hogan@proton.com"
#  },
#  ...
#]

if [[ x$DEBUG != x ]]; then
    set -x
fi
set -o pipefail

OPTION="$1"

if [[ -z $INATUR_COOKIE ]]; then
    printf "\nNo INATUR_COOKIE env variable set! Execute the following line in your shell\n"
    printf "eval \\\"\$(./cookie-store export)\\\""
    exit 1
fi

sort_and_extract(){
    jq --exit-status '
        [
          .resultat[]
          | select( false == .erAvbestilt )
        ]
        | sort_by( ."kjøpdatoliste"[0] )
        | map( { when_as_text : .datoerTekstUtenPrefix,
                 who  : .person.navn,
                 phone: .person.telefonnummer.nummerMedLandskode,
                 email: .person.epost,
                 checkin: ( ."kjøpdatoliste"[0] / 1000 + (3600*(15)) | strflocaltime("%F @ 15:00") ),
                 checkout:  ( (."kjøpdatoliste"[-1] / 1000) + (3600*(24+14)) | strflocaltime("%F @ 14:00") ),
                 checkout_unix: ( (."kjøpdatoliste"[-1] / 1000) + (3600*(24+14)) ),
                 first_day: (."kjøpdatoliste"[0] / 1000 | strflocaltime("%F")),
                 first_day_unix: (."kjøpdatoliste"[0] / 1000 ),
                 last_day_before_checkout:  ( (."kjøpdatoliste"[-1] / 1000) | strflocaltime("%F") ),
                 provider: "inatur"
           })
           | map( select( .first_day_unix > now or .checkout_unix > now ))
    ' 

    # converting the timestamps to local time looks something like this:
    #   d=new Date(1691964000000)
    #   console.log(new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Europe/Oslo' }).format(d))
}

fetch_data(){
    local OUTPUT_FILE=$1

    if HTTP_STATUS=$(
        curl --silent --show-error \
            -H 'Accept: application/json, text/javascript, */*; q=0.01' \
            -H "Cookie: $INATUR_COOKIE" \
            -w '%{http_code}' \
            -o "$OUTPUT_FILE" \
            'https://www.inatur.no/min-side/salg/sok'
    ); then
        if [[ "$HTTP_STATUS" != "200" ]]; then
            printf "FEIL: fikk HTTP %s fra Inatur API\n" "$HTTP_STATUS" >> /dev/stderr
            printf "Svar (første 240 tegn): " >> /dev/stderr
            head -c 240 "$OUTPUT_FILE" >> /dev/stderr
            printf "\n" >> /dev/stderr
            return 1
        fi
    else
        printf "FEIL: greide ikke laste ned data\n" >> /dev/stderr
        cat "$OUTPUT_FILE" >> /dev/stderr
        return 1
    fi

    if ! jq -e 'type == "object" and has("resultat") and (.resultat | type == "array")' "$OUTPUT_FILE" >/dev/null 2>&1; then
        printf "FEIL: mottok ugyldig API-respons (kan tyde på utløpt token)\n" >> /dev/stderr
        printf "Svar (første 240 tegn): " >> /dev/stderr
        head -c 240 "$OUTPUT_FILE" >> /dev/stderr
        printf "\n" >> /dev/stderr
        return 1
    fi

    if ! jq -e '.' "$OUTPUT_FILE" >/dev/null 2>&1; then
        printf "FEIL: ikke gyldig JSON fra Inatur API (kan tyde på utløpt token)\n" >> /dev/stderr
        printf "Svar (første 240 tegn): " >> /dev/stderr
        head -c 240 "$OUTPUT_FILE" >> /dev/stderr
        printf "\n" >> /dev/stderr
        return 1
    fi

    return 0
}

if [[ "$INATUR_COOKIE" == "" ]]; then
    echo "Sett INATUR_COOKIE=\"FPID=FPID2....\""
    exit 1
fi

filter_output(){
    local FILE=$1
    if [[ $OPTION == "--anon" ]]; then
        jq --raw-output 'map(.when_as_text)[]' "$FILE"
    else
        cat "$FILE"
    fi
}

usage(){
    printf "\nUSAGE: $0 [-h | --anon]\n"
    printf "  --anon    Anonymize output\n"
    exit 1
}

if [[ $OPTION != "" && $OPTION != "--anon" ]]; then
    usage
fi

RAW_JSON=$(mktemp)
SORTED_JSON=$(mktemp)
trap 'rm -f "$RAW_JSON" "$SORTED_JSON"' EXIT

if ! fetch_data "$RAW_JSON"; then
    exit 1
fi

if ! sort_and_extract < "$RAW_JSON" > "$SORTED_JSON"; then
    echo "FEIL: filtrering av data feilet\n" >> /dev/stderr
    exit 1
fi

filter_output "$SORTED_JSON"
