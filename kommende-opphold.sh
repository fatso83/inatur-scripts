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


# ikke sikker på om jeg skal gjøre noe med dette ennå ... p.t. er dette mer som en analyse
create_cookies(){
    local rm_token=Y2FybG...
    local heroku=ADaDaANoA2...
    local session=80337103228...
    local tilbyder=63ee193639a4...
    printf "%s" "Cookie: rm=${rm_token}; heroku-session-affinity=${heroku}; session=${session}; aktivTilbyder=${tilbyder}"    
}

# usikker på hva "fra" og "til" betyr her: start salg eller start opphold?
params() {
    #local from_ts=1672527600000;
    #local to_ts=1682892000000;
    #printf "?fra=${from}&til=${to_ts}" 
    echo ''
}

cookies(){
    printf "%s" "$INATUR_COOKIE"
}

sort_and_extract(){
    jq '[ 
          .resultat[] 
          | select( false == .erAvbestilt )
        ] 
        | sort_by( ."kjøpdatoliste"[0] ) 
        | map( { when : .datoerTekstUtenPrefix, 
                 who  : .person.navn,
                 phone: .person.telefonnummer.nummerMedLandskode, 
                 email: .person.epost
           })' 
}

fetch_data(){
    curl --silent "https://www.inatur.no/min-side/salg/sok"   \
         -H 'Accept: application/json, text/javascript, */*; q=0.01'   \
         -H "$(cookies)"
}

if [[ "$INATUR_COOKIE" == "" ]]; then
    echo "Sett INATUR_COOKIE=\"Cookie: FPID=FPID2....\""
    exit 1
fi

fetch_data | sort_and_extract
