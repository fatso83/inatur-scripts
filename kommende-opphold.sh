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

OPTION="$1"

if [[ -z $INATUR_COOKIE ]]; then 
    printf "\nNo INATUR_COOKIE env variable set! Trying to fetch automatically ...\n"
    eval "$(./fetch-cookie --doExport)"
fi

sort_and_extract(){
    jq '[ 
          .resultat[] 
          | select( false == .erAvbestilt )
        ] 
        | sort_by( ."kjøpdatoliste"[0] ) 
        | map( { when_as_text : .datoerTekstUtenPrefix, 
                 who  : .person.navn,
                 phone: .person.telefonnummer.nummerMedLandskode, 
                 email: .person.epost,
                 checkin: (."kjøpdatoliste"[0] / 1000 | strflocaltime("%F @ 15:00")),
                 checkout:  ( (."kjøpdatoliste"[-1] / 1000) + (3600*24) | strflocaltime("%F @ 13:00") ),
                 first_day: (."kjøpdatoliste"[0] / 1000 | strflocaltime("%F")),
                 first_day_unix: (."kjøpdatoliste"[0] / 1000 ),
                 last_day_before_checkout:  ( (."kjøpdatoliste"[-1] / 1000) | strflocaltime("%F") ),
                 provider: "inatur"
           })
           | map( select( .first_day_unix > now ))
        ' 

    # converting the timestamps to local time looks something like this:
    #   d=new Date(1691964000000)
    #   console.log(new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Europe/Oslo' }).format(d))
}

fetch_data(){
    TMP=$(mktemp)
    if curl --silent --fail-with-body "https://www.inatur.no/min-side/salg/sok"   \
         -H 'Accept: application/json, text/javascript, */*; q=0.01'   \
         -H "Cookie: $INATUR_COOKIE" -o "$TMP"; then
        cat $TMP
    else
        printf "FEIL: greide ikke laste ned data\n" >> /dev/stderr
        cat $TMP >> /dev/stderr
        exit 1
    fi
}

if [[ "$INATUR_COOKIE" == "" ]]; then
    echo "Sett INATUR_COOKIE=\"FPID=FPID2....\""
    exit 1
fi

filter_output(){
    if [[ $OPTION == "--anon" ]]; then 
        jq --raw-output 'map(.when_as_text)[]'
    else
        cat
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


fetch_data | sort_and_extract | filter_output
