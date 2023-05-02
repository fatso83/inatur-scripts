# Notater og skript for bruk av API på iNatur

## API
Bruker unix timestamps og url-encoding av "norske parametre". 
Typisk eksempelkall "Copied as Curl" i Chrome:

```
curl 'https://www.inatur.no/min-side/salg/sok?&s=%7B%22felt%22%3A%22opprettet%22%2C%22rekkef%C3%B8lge%22%3A%22SYNKENDE%22%7D&fra=1672527600000&til=1682892000000' \
  -H 'Accept: application/json, text/javascript, */*; q=0.01' \
  -H 'Cookie: FPID=FPID2.2....28663; CookieConsent={stamp:%27JVhrHdvUo4iVogre4K822NgVoZbE/GIO5t/TQ94s4CRu1EvvmQgDkA==%27%2Cnecessary:true%2Cpreferences:false%2Cstatistics:false%2Cmarketing:false%2Cmethod:%27explicit%27%2Cver:2%2Cutc:1680624888058%2Cregion:%27no%27}; rm=Y2Fyb...; heroku-session-affinity=ADaD...__; session=8033...; aktivTilbyder=63ee193639a4b03....' \
  -H 'If-Modified-Since: Mon, 01 May 2023 16:51:00 GMT' \
  -H 'If-None-Match: "0d31f230a588336503241dd0959a28cf1--gzip"' \
```
Stien i strengen over ser slik ut etter dekoding:
```
/min-side/salg/sok?&s={"felt":"opprettet","rekkefølge":"SYNKENDE"}&fra=1672527600000&til=1682892000000
```

### Salg på Min Side
```
/min-side/salg/sok?&s={"felt":"opprettet","rekkefølge":"SYNKENDE"}&fra=${unix_ts_from}&til=${unix_ts_to}
```

