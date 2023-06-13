#!/bin/bash

if [[ $# != 2 ]]; then
    echo USAGE: $0 27-3-2022 24-4-2022
    exit
fi

FROM=$1
TO=$2

fetch(){
    local TMP=$(mktemp)
    curl --silent --fail-with-body "https://www.inatur.no/tilbud/63ee3bc2d0440d29d6c7ef45/kort/63ee3ba9d0440d29d6c7ef44/tilgjengelighet/$FROM/$TO" \
    -H 'Accept: application/json, text/javascript, */*; q=0.01'            -H "Cookie: $INATUR_COOKIE" -o $TMP

    if [[ $? != 0 ]]; then
        echo -n "ERROR: "
        cat $TMP
        exit 1
    fi

    cat $TMP
}

fetch | jq '.[] | select( .antall == 1 ) | .datoStreng'
