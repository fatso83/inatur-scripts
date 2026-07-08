# Airbnb to Inatur One-Way Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a script that reads Airbnb iCal bookings and makes Inatur cabin availability match by adding and removing only script-owned blocked date periods.

**Architecture:** Treat Inatur as a full-document update API: fetch the current cabin offer draft, replace only `kort[].antall.perioder[]` entries marked with the script keyword, `PUT` the whole offer back, write Inatur changelog entries, and publish explicitly. The sync is one-way from Airbnb to Inatur; manually created Inatur blocks are preserved unless they carry the script marker.

**Tech Stack:** Bash for command wrappers matching the repo, Node.js for iCal parsing/diffing/date handling, `curl` for Inatur calls, `jq` for shell-level inspection, Node built-in `node:test` for unit tests.

## Implementation Status

Implemented in `sync-airbnb-inatur.js` and `lib/*`.

- CLI supports preview mode by default, offline fixtures, live Airbnb iCal fetch, live Inatur draft fetch, and publish mode.
- Runtime loads `.env`, uses `./cookie-store validate|refresh|export`, and reads the full `cookies.json` browser cookie jar for authenticated Inatur web2/www calls.
- Safety marker is `[airbnb-inatur-sync]`; the script removes only periods whose comment includes that marker.
- Live Inatur fetch now follows the observed flow:
  1. `POST https://web2.inatur.no/min-side/selger/<sellerId>/salgssider.data` with `intent=editDraft`.
  2. Follow the returned seller-role URL to refresh `aktivTilbyder` in the cookie jar.
  3. Fetch `https://www.inatur.no/min-side/tilbud/rediger/utkast/<nodeId>?spraak=no`.
  4. Extract the full offer model from `tilbudJson = JSON.parse(JSON.stringify(...))` in the HTML.
- Verification completed:
  - `npm test` passes.
  - Offline fixture preview prints one delete and one add.
  - Live `./sync-airbnb-inatur.js` successfully fetched Airbnb and Inatur and reported two adds, zero deletes.

`--publish` extracts the CSRF token from the edit page HTML and no longer requires `INATUR_CSRF_TOKEN`.

---

## Calendar Sources

Use these sources at runtime:

- Airbnb desired-state calendar: `AIRBNB_ICAL_URL`
  - The script has the Holmevann Airbnb calendar URL as an approved fallback.
  - `AIRBNB_ICAL_URL` can override the fallback from `.env` or shell env.
- Inatur published availability iCal:

```text
https://www.inatur.no/api/external/v1/sales-pages/63ee3bc2d0440d29d6c7ef45/products/63ee3ba9d0440d29d6c7ef44/availability/ical
```

The Inatur iCal export is useful for verification and sanity checks, but the editable source of truth for script-owned blocks is still the authenticated offer JSON because it contains the `kommentar` marker.

## HAR Findings

The attached HAR contains the complete flow for adding a manual block with comment `eksempelsperring` and publishing with a comment containing `codex`.

Relevant calls:

1. Open or create current edit draft from the stable published sales page id:

```text
POST https://web2.inatur.no/min-side/selger/63ee193639a4b03b97f009e9/salgssider.data
Content-Type: application/x-www-form-urlencoded;charset=UTF-8

intent=editDraft&salesPageId=63ee3bc2d0440d29d6c7ef45
```

The refreshed-page HAR shows this call returning `202 text/x-script`. The response body was not saved in the HAR, but the next request uses the current draft edit id:

```text
GET https://www.inatur.no/min-side/tilbud/rediger/6a4d05dd8c2f9d217c8c7b54?spraak=no
```

This matters because the edit/draft id can differ between sessions. Treat `63ee3bc2d0440d29d6c7ef45` as the stable sales page id and resolve the current edit id before fetching or saving the full offer.

2. Fetch the current edit model:

```text
GET https://www.inatur.no/min-side/tilbud/rediger/6a4d05dd8c2f9d217c8c7b54?spraak=no
Headers:
  Accept: application/json, text/javascript, */*; q=0.01
  x-requested-with: XMLHttpRequest
  Cookie: <session cookies>
```

Initial HAR inspection suggested this as a JSON endpoint, but live verification showed the authenticated flow may return the edit UI as HTML. The implemented script therefore fetches the `utkast/<nodeId>` edit page and extracts the embedded `tilbudJson` object from the HTML instead of relying on this endpoint returning JSON.

3. Read public availability:

```text
GET https://www.inatur.no/tilbud/6a4cfb7b4bbed7076f499cc0/kort/63ee3ba9d0440d29d6c7ef44/tilgjengelighet/1-1-2026/31-12-2026
```

This is useful for verification, but not enough to edit blocks.

4. Save draft after changing blocked dates:

```text
PUT https://www.inatur.no/min-side/tilbud/rediger/6a4cfb7b4bbed7076f499cc0?spraak=no
Headers:
  Content-Type: application/json
  x-requested-with: XMLHttpRequest
  x-csrf-token: <session csrf token>
  Cookie: <session cookies>
```

The request body is the full offer JSON. The blocked periods live here:

```json
{
  "kort": [
    {
      "id": "63ee3ba9d0440d29d6c7ef44",
      "antall": {
        "standardverdi": 1,
        "perioder": [
          {
            "fra": 1792447200000,
            "til": 1792533600000,
            "verdi": 0,
            "kommentar": "eksempelsperring",
            "fraFormatert": "20.10.2026",
            "tilFormatert": "21.10.2026"
          }
        ],
        "harPerioder": true
      }
    }
  ]
}
```

5. Write changelog for the card change:

```text
POST https://www.inatur.no/min-side/tilbud/rediger/api/v1/changelog?attribute=kort
```

Body shape:

```json
{
  "type": "TILBUD",
  "attribute": "kort",
  "method": "KORT_CHANGED",
  "from": {
    "value": {
      "numKort": 1,
      "kortdetaljer": "<previous card object>"
    }
  },
  "to": {
    "value": {
      "numKort": 1,
      "kortdetaljer": "<updated card object>"
    }
  },
  "nodeId": "63ee3bc2d0440d29d6c7ef45"
}
```

6. Publish draft:

```text
PUT https://www.inatur.no/min-side/tilbud/rediger/6a4cfb7b4bbed7076f499cc0?spraak=no
```

Same full offer JSON, but with:

```json
{
  "skalPublisere": true
}
```

7. Write changelog for publishing:

```text
POST https://www.inatur.no/min-side/tilbud/rediger/api/v1/changelog?attribute=skalPublisere
```

Body shape:

```json
{
  "type": "TILBUD",
  "attribute": "skalPublisere",
  "method": "CREATED",
  "from": {},
  "to": {
    "value": {
      "comment": "Oppdatert av airbnb-inatur-sync [codex-sync]\n"
    }
  },
  "nodeId": "63ee3bc2d0440d29d6c7ef45"
}
```

Important IDs from the HAR:

- Stable published sales page id / node id: `63ee3bc2d0440d29d6c7ef45`
- Edit offer id in first save HAR: `6a4cfb7b4bbed7076f499cc0`
- Edit offer id in refreshed-page HAR: `6a4d05dd8c2f9d217c8c7b54`
- Published offer/node id: `63ee3bc2d0440d29d6c7ef45`
- Cabin card id: `63ee3ba9d0440d29d6c7ef44`
- Seller id: `63ee193639a4b03b97f009e9`

Use marker keyword:

```text
[airbnb-inatur-sync]
```

Only entries whose `kommentar` contains this marker may be removed or replaced by the script.

## File Structure

- Create: `lib/airbnb-ical.js`
  - Parse Airbnb iCal into normalized stay ranges.
  - Convert all-day `DTSTART`/`DTEND` values to Inatur local date periods.

- Create: `lib/inatur-offer.js`
  - Extract target card from offer JSON.
  - Convert stays to `antall.perioder`.
  - Preserve manual periods.
  - Remove only marker-owned periods.
  - Produce changelog payloads.

- Create: `lib/sync-diff.js`
  - Compare desired Airbnb stays with current script-owned Inatur periods.
  - Produce preview actions: `add`, `remove`, `keep`.
  - Format human-readable output such as `vil legge til sperring 2026-10-20 -> 2026-10-22`.

- Create: `lib/inatur-client.js`
  - HTTP wrapper around Inatur edit, save, changelog, publish, and availability verification calls.
  - Use `INATUR_COOKIE`; use `INATUR_CSRF_TOKEN` initially, then add dynamic CSRF extraction once confirmed.
  - Resolve the current draft edit id from stable `INATUR_NODE_ID`/seller id before fetching the edit JSON.
  - Fetch Inatur external iCal for post-publish verification when `INATUR_AVAILABILITY_ICAL_URL` is configured.

- Create: `sync-airbnb-inatur.js`
  - CLI entrypoint.
  - Supports default preview mode, `--publish`, `--from-file`, `--ical-url`, and config env vars.
  - Loads `.env` itself.
  - Calls `./cookie-store validate|refresh|export` automatically before authenticated Inatur calls.

- Create: `test/airbnb-ical.test.js`
  - Unit tests for iCal parsing and checkout-exclusive date handling.

- Create: `test/inatur-offer.test.js`
  - Unit tests for period merge/diff safety.

- Create: `test/sync-diff.test.js`
  - Unit tests for add/remove/keep action generation and preview text.

- Modify: `package.json`
  - Add `test` script using Node's built-in test runner.

- Modify: `README.md`
  - Document configuration, preview, publish, and safety marker behavior.

## Task 1: Test Harness

**Files:**
- Modify: `package.json`
- Create: `test/fixtures/airbnb-basic.ics`

- [ ] **Step 1: Add a failing test command**

Update `package.json`:

```json
{
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "debug": "^4.4.1",
    "openid-client": "^6.6.2",
    "playwright": "^1.53.2"
  },
  "devDependencies": {
    "@types/node": "^24.0.10"
  }
}
```

- [ ] **Step 2: Add fixture**

Create `test/fixtures/airbnb-basic.ics`:

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261020
DTEND;VALUE=DATE:20261022
SUMMARY:Reserved
UID:airbnb-example-1
END:VEVENT
END:VCALENDAR
```

- [ ] **Step 3: Run test command to verify no tests exist yet**

Run: `npm test`

Expected: Node test runner exits successfully or reports zero tests.

## Task 2: iCal Parser

**Files:**
- Create: `lib/airbnb-ical.js`
- Create: `test/airbnb-ical.test.js`

- [ ] **Step 1: Write failing parser tests**

Create `test/airbnb-ical.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseAirbnbIcal } = require('../lib/airbnb-ical');

test('parses all-day Airbnb events as checkout-exclusive stays', () => {
  const ics = fs.readFileSync(path.join(__dirname, 'fixtures/airbnb-basic.ics'), 'utf8');

  assert.deepEqual(parseAirbnbIcal(ics), [
    {
      uid: 'airbnb-example-1',
      startDate: '2026-10-20',
      endDateExclusive: '2026-10-22',
      summary: 'Reserved'
    }
  ]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- test/airbnb-ical.test.js`

Expected: FAIL with `Cannot find module '../lib/airbnb-ical'`.

- [ ] **Step 3: Implement parser**

Create `lib/airbnb-ical.js`:

```js
function unfoldIcal(input) {
  return input.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseIcalDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Unsupported iCal date: ${value}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseAirbnbIcal(input) {
  const lines = unfoldIcal(input).split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.startDate && current?.endDateExclusive) {
        events.push(current);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const [rawName, ...rest] = line.split(':');
    const value = rest.join(':');
    const name = rawName.split(';')[0].toUpperCase();

    if (name === 'DTSTART') current.startDate = parseIcalDate(value);
    if (name === 'DTEND') current.endDateExclusive = parseIcalDate(value);
    if (name === 'SUMMARY') current.summary = value;
    if (name === 'UID') current.uid = value;
  }

  return events;
}

module.exports = { parseAirbnbIcal };
```

- [ ] **Step 4: Run parser tests**

Run: `npm test -- test/airbnb-ical.test.js`

Expected: PASS.

## Task 3: Inatur Period Mapping and Safety

**Files:**
- Create: `lib/inatur-offer.js`
- Create: `test/inatur-offer.test.js`

- [ ] **Step 1: Write failing safety tests**

Create `test/inatur-offer.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildScriptPeriod,
  replaceScriptOwnedPeriods
} = require('../lib/inatur-offer');

test('builds Inatur zero-capacity periods with script marker', () => {
  assert.deepEqual(
    buildScriptPeriod({
      startDate: '2026-10-20',
      endDateExclusive: '2026-10-22',
      uid: 'abc'
    }),
    {
      fra: 1792447200000,
      til: 1792533600000,
      verdi: 0,
      kommentar: '[airbnb-inatur-sync] uid=abc',
      fraFormatert: '20.10.2026',
      tilFormatert: '21.10.2026'
    }
  );
});

test('uses Europe/Oslo midnight for winter dates', () => {
  assert.equal(
    buildScriptPeriod({
      startDate: '2026-01-20',
      endDateExclusive: '2026-01-21',
      uid: 'winter'
    }).fra,
    1768863600000
  );
});

test('replaces only script-owned periods and preserves manual periods', () => {
  const manual = { fra: 1, til: 2, verdi: 0, kommentar: 'familie' };
  const oldScript = { fra: 3, til: 4, verdi: 0, kommentar: '[airbnb-inatur-sync] uid=old' };
  const nextScript = { fra: 5, til: 6, verdi: 0, kommentar: '[airbnb-inatur-sync] uid=new' };

  assert.deepEqual(replaceScriptOwnedPeriods([manual, oldScript], [nextScript]), [manual, nextScript]);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- test/inatur-offer.test.js`

Expected: FAIL with `Cannot find module '../lib/inatur-offer'`.

- [ ] **Step 3: Implement period mapping**

Create `lib/inatur-offer.js`:

```js
const MARKER = '[airbnb-inatur-sync]';

function getTimeZoneOffsetMs(timeZone, utcMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(utcMs));

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );

  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - utcMs;
}

function dateToOsloMidnightMs(date) {
  const [year, month, day] = date.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  return utcMidnight - getTimeZoneOffsetMs('Europe/Oslo', utcMidnight);
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatNoDate(date) {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

function buildScriptPeriod(stay) {
  const tilDate = addDays(stay.endDateExclusive, -1);
  return {
    fra: dateToOsloMidnightMs(stay.startDate),
    til: dateToOsloMidnightMs(tilDate),
    verdi: 0,
    kommentar: `${MARKER} uid=${stay.uid}`,
    fraFormatert: formatNoDate(stay.startDate),
    tilFormatert: formatNoDate(tilDate)
  };
}

function isScriptOwnedPeriod(period) {
  return typeof period.kommentar === 'string' && period.kommentar.includes(MARKER);
}

function replaceScriptOwnedPeriods(existingPeriods, nextScriptPeriods) {
  return [
    ...existingPeriods.filter((period) => !isScriptOwnedPeriod(period)),
    ...nextScriptPeriods
  ].sort((a, b) => a.fra - b.fra || a.til - b.til);
}

function getTargetCard(offer, cardId) {
  const card = offer.kort?.find((entry) => entry.id === cardId);
  if (!card) throw new Error(`Could not find Inatur card ${cardId}`);
  return card;
}

function updateOfferPeriods(offer, cardId, scriptPeriods) {
  const updatedOffer = structuredClone(offer);
  const card = getTargetCard(updatedOffer, cardId);
  const existing = card.antall?.perioder ?? [];
  card.antall = {
    ...card.antall,
    perioder: replaceScriptOwnedPeriods(existing, scriptPeriods),
    harPerioder: true
  };
  return updatedOffer;
}

function buildKortChangelog(nodeId, beforeCard, afterCard) {
  return {
    type: 'TILBUD',
    attribute: 'kort',
    method: 'KORT_CHANGED',
    from: { value: { numKort: 1, kortdetaljer: beforeCard } },
    to: { value: { numKort: 1, kortdetaljer: afterCard } },
    nodeId
  };
}

function buildPublishChangelog(nodeId, comment) {
  return {
    type: 'TILBUD',
    attribute: 'skalPublisere',
    method: 'CREATED',
    from: {},
    to: { value: { comment: `${comment}\n` } },
    nodeId
  };
}

module.exports = {
  MARKER,
  buildScriptPeriod,
  buildKortChangelog,
  buildPublishChangelog,
  getTargetCard,
  replaceScriptOwnedPeriods,
  updateOfferPeriods
};
```

- [ ] **Step 4: Run safety tests**

Run: `npm test -- test/inatur-offer.test.js`

Expected: PASS.

- [ ] **Step 5: Verify timezone tests cover both offsets**

Run: `npm test -- test/inatur-offer.test.js`

Expected: PASS for both the October `+02:00` HAR example and the January `+01:00` winter example.

## Task 4: Dry-Run Diff

**Files:**
- Create: `lib/sync-diff.js`
- Create: `test/sync-diff.test.js`

- [ ] **Step 1: Write failing diff tests**

Create `test/sync-diff.test.js`:

```js
const assert = require('node:assert/strict');
const test = require('node:test');

const { createSyncDiff, formatDryRun } = require('../lib/sync-diff');

test('reports add, remove, and keep actions for script-owned blocks', () => {
  const desiredPeriods = [
    {
      fra: 1792447200000,
      til: 1792533600000,
      kommentar: '[airbnb-inatur-sync] uid=keep',
      fraFormatert: '20.10.2026',
      tilFormatert: '21.10.2026',
      verdi: 0
    },
    {
      fra: 1792620000000,
      til: 1792706400000,
      kommentar: '[airbnb-inatur-sync] uid=add',
      fraFormatert: '22.10.2026',
      tilFormatert: '23.10.2026',
      verdi: 0
    }
  ];

  const existingPeriods = [
    {
      fra: 1792447200000,
      til: 1792533600000,
      kommentar: '[airbnb-inatur-sync] uid=keep',
      fraFormatert: '20.10.2026',
      tilFormatert: '21.10.2026',
      verdi: 0
    },
    {
      fra: 1792792800000,
      til: 1792879200000,
      kommentar: '[airbnb-inatur-sync] uid=remove',
      fraFormatert: '24.10.2026',
      tilFormatert: '25.10.2026',
      verdi: 0
    },
    {
      fra: 1792965600000,
      til: 1793052000000,
      kommentar: 'familie',
      fraFormatert: '26.10.2026',
      tilFormatert: '27.10.2026',
      verdi: 0
    }
  ];

  assert.deepEqual(createSyncDiff({ existingPeriods, desiredPeriods }), {
    add: [desiredPeriods[1]],
    remove: [existingPeriods[1]],
    keep: [desiredPeriods[0]]
  });
});

test('formats dry-run output as human-readable Norwegian actions', () => {
  const output = formatDryRun({
    add: [{ fraFormatert: '22.10.2026', tilFormatert: '23.10.2026', kommentar: '[airbnb-inatur-sync] uid=add' }],
    remove: [{ fraFormatert: '24.10.2026', tilFormatert: '25.10.2026', kommentar: '[airbnb-inatur-sync] uid=remove' }],
    keep: []
  });

  assert.match(output, /vil legge til sperring 22\.10\.2026 -> 23\.10\.2026/);
  assert.match(output, /vil slette sperring 24\.10\.2026 -> 25\.10\.2026/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- test/sync-diff.test.js`

Expected: FAIL with `Cannot find module '../lib/sync-diff'`.

- [ ] **Step 3: Implement diff logic**

Create `lib/sync-diff.js`:

```js
const { MARKER } = require('./inatur-offer');

function periodKey(period) {
  const uidMatch = typeof period.kommentar === 'string' ? /uid=([^ ]+)/.exec(period.kommentar) : null;
  return uidMatch ? `uid:${uidMatch[1]}` : `dates:${period.fra}:${period.til}`;
}

function isScriptOwned(period) {
  return typeof period.kommentar === 'string' && period.kommentar.includes(MARKER);
}

function createSyncDiff({ existingPeriods, desiredPeriods }) {
  const existingScriptPeriods = existingPeriods.filter(isScriptOwned);
  const existingByKey = new Map(existingScriptPeriods.map((period) => [periodKey(period), period]));
  const desiredByKey = new Map(desiredPeriods.map((period) => [periodKey(period), period]));

  return {
    add: desiredPeriods.filter((period) => !existingByKey.has(periodKey(period))),
    remove: existingScriptPeriods.filter((period) => !desiredByKey.has(periodKey(period))),
    keep: desiredPeriods.filter((period) => existingByKey.has(periodKey(period)))
  };
}

function describePeriod(period) {
  return `${period.fraFormatert} -> ${period.tilFormatert} (${period.kommentar})`;
}

function formatDryRun(diff) {
  const lines = ['Dry run: ingen endringer blir lagret eller publisert.'];

  for (const period of diff.remove) {
    lines.push(`vil slette sperring ${describePeriod(period)}`);
  }
  for (const period of diff.add) {
    lines.push(`vil legge til sperring ${describePeriod(period)}`);
  }
  for (const period of diff.keep) {
    lines.push(`beholder sperring ${describePeriod(period)}`);
  }
  if (diff.add.length === 0 && diff.remove.length === 0) {
    lines.push('ingen endringer');
  }

  return lines.join('\n');
}

module.exports = { createSyncDiff, formatDryRun };
```

- [ ] **Step 4: Run diff tests**

Run: `npm test -- test/sync-diff.test.js`

Expected: PASS.

## Task 5: Inatur Client

**Files:**
- Create: `lib/inatur-client.js`

- [ ] **Step 1: Implement client with explicit CSRF env fallback**

Create `lib/inatur-client.js`:

```js
async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Cookie: process.env.INATUR_COOKIE ?? '',
      ...options.headers
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function requestText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: '*/*',
      Cookie: process.env.INATUR_COOKIE ?? '',
      ...options.headers
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return text;
}

function requireCsrfToken() {
  if (!process.env.INATUR_CSRF_TOKEN) {
    throw new Error('Set INATUR_CSRF_TOKEN from the edit-page x-csrf-token header until dynamic extraction is implemented.');
  }
  return process.env.INATUR_CSRF_TOKEN;
}

async function resolveEditDraftId({ sellerId, nodeId }) {
  const body = new URLSearchParams({
    intent: 'editDraft',
    salesPageId: nodeId
  });
  const responseText = await requestText(`https://web2.inatur.no/min-side/selger/${sellerId}/salgssider.data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body
  });

  const match = /rediger\/([a-f0-9]{24})/.exec(responseText);
  if (!match) {
    throw new Error('Could not find current edit draft id in editDraft response');
  }
  return match[1];
}

async function fetchOffer(editOfferId) {
  return requestJson(`https://www.inatur.no/min-side/tilbud/rediger/${editOfferId}?spraak=no`, {
    headers: { 'x-requested-with': 'XMLHttpRequest' }
  });
}

async function saveOffer(editOfferId, offer) {
  return requestJson(`https://www.inatur.no/min-side/tilbud/rediger/${editOfferId}?spraak=no`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-csrf-token': requireCsrfToken()
    },
    body: JSON.stringify(offer)
  });
}

async function writeChangelog(attribute, payload) {
  return requestJson(`https://www.inatur.no/min-side/tilbud/rediger/api/v1/changelog?attribute=${encodeURIComponent(attribute)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': requireCsrfToken()
    },
    body: JSON.stringify(payload)
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/calendar, text/plain, */*',
      Cookie: process.env.INATUR_COOKIE ?? ''
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return text;
}

module.exports = { fetchOffer, fetchText, resolveEditDraftId, saveOffer, writeChangelog };
```

- [ ] **Step 2: Add dynamic CSRF extraction discovery**

Run a manual capture against the edit page and find where the CSRF token is emitted. If it is embedded in HTML, extend `fetchOffer` or add `fetchCsrfToken(editOfferId)` to parse it. If it is only available in an initial browser bootstrap, keep `INATUR_CSRF_TOKEN` as a required env var.

## Task 6: Sync CLI Dry Run

**Files:**
- Create: `sync-airbnb-inatur.js`

- [ ] **Step 1: Implement dry-run CLI**

Create `sync-airbnb-inatur.js`:

```js
#!/usr/bin/env node

const fs = require('node:fs/promises');
const { parseAirbnbIcal } = require('./lib/airbnb-ical');
const {
  buildScriptPeriod,
  getTargetCard,
  updateOfferPeriods
} = require('./lib/inatur-offer');
const { createSyncDiff, formatDryRun } = require('./lib/sync-diff');
const { fetchOffer, resolveEditDraftId } = require('./lib/inatur-client');

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function readIcal() {
  const file = getArg('--from-file');
  if (file) return fs.readFile(file, 'utf8');

  const url = getArg('--ical-url') ?? process.env.AIRBNB_ICAL_URL;
  if (!url) throw new Error('Pass --from-file, --ical-url, or AIRBNB_ICAL_URL');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from Airbnb iCal URL`);
  return response.text();
}

async function main() {
  const editOfferId = process.env.INATUR_EDIT_OFFER_ID ?? await resolveEditDraftId({
    sellerId: process.env.INATUR_SELLER_ID ?? '63ee193639a4b03b97f009e9',
    nodeId: process.env.INATUR_NODE_ID ?? '63ee3bc2d0440d29d6c7ef45'
  });
  const cardId = process.env.INATUR_CARD_ID ?? '63ee3ba9d0440d29d6c7ef44';

  const stays = parseAirbnbIcal(await readIcal());
  const scriptPeriods = stays.map(buildScriptPeriod);
  const offer = await fetchOffer(editOfferId);
  const beforeCard = getTargetCard(offer, cardId);
  const updatedOffer = updateOfferPeriods(offer, cardId, scriptPeriods);
  const afterCard = getTargetCard(updatedOffer, cardId);
  const diff = createSyncDiff({
    existingPeriods: beforeCard.antall.perioder ?? [],
    desiredPeriods: scriptPeriods
  });

  console.log(formatDryRun(diff));
  console.log(JSON.stringify({
    dryRun: true,
    stays: stays.length,
    add: diff.add.length,
    remove: diff.remove.length,
    keep: diff.keep.length,
    beforeScriptOwned: beforeCard.antall.perioder.filter((p) => p.kommentar?.includes('[airbnb-inatur-sync]')).length,
    afterScriptOwned: afterCard.antall.perioder.filter((p) => p.kommentar?.includes('[airbnb-inatur-sync]')).length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 2: Make executable**

Run: `chmod +x sync-airbnb-inatur.js`

- [ ] **Step 3: Run against fixture**

Run:

```bash
eval "$(./cookie-store export)"
./sync-airbnb-inatur.js --from-file test/fixtures/airbnb-basic.ics
```

Expected: JSON output showing one script-owned period and no write.

Expected preview text includes lines like:

```text
Forhandsvisning: ingen endringer blir lagret eller publisert.
vil slette sperring 24.10.2026 -> 25.10.2026 ([airbnb-inatur-sync] uid=...)
vil legge til sperring 22.10.2026 -> 23.10.2026 ([airbnb-inatur-sync] uid=...)
```

## Task 7: Save, Changelog, and Publish

**Files:**
- Modify: `sync-airbnb-inatur.js`

- [ ] **Step 1: Add write path behind `--publish`**

Modify the CLI so it only writes when `--publish` is present:

```js
const shouldPublish = process.argv.includes('--publish');
```

When `shouldPublish` is true:

1. Build `kort` changelog using original and updated card.
2. Save updated offer with `saveOffer`.
3. Write `kort` changelog.
4. Set `updatedOffer.skalPublisere = true`.
5. Save updated offer again.
6. Write `skalPublisere` changelog with comment `Oppdatert av airbnb-inatur-sync [codex-sync]`.

- [ ] **Step 2: Add no-op guard**

If `diff.add.length === 0 && diff.remove.length === 0`, print `No changes` and skip `PUT`, changelog, and publish.

- [ ] **Step 3: Run preview before live publish**

Run:

```bash
./sync-airbnb-inatur.js --from-file test/fixtures/airbnb-basic.ics
```

Expected: shows exact changes and exits without writing.

- [ ] **Step 4: Run live publish with a controlled fixture**

Run:

```bash
./sync-airbnb-inatur.js --from-file test/fixtures/airbnb-basic.ics --publish
```

Expected: two successful `PUT` calls and two successful changelog calls, matching the HAR flow.

## Task 8: Verification and Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document env vars**

Add:

```text
AIRBNB_ICAL_URL=<Airbnb iCal URL, secret, do not commit>
INATUR_AVAILABILITY_ICAL_URL=https://www.inatur.no/api/external/v1/sales-pages/63ee3bc2d0440d29d6c7ef45/products/63ee3ba9d0440d29d6c7ef44/availability/ical
INATUR_COOKIE
INATUR_CSRF_TOKEN
INATUR_SELLER_ID=63ee193639a4b03b97f009e9
INATUR_NODE_ID=63ee3bc2d0440d29d6c7ef45
INATUR_CARD_ID=63ee3ba9d0440d29d6c7ef44
# Optional override, normally resolved via editDraft:
INATUR_EDIT_OFFER_ID=<current draft edit id>
```

- [ ] **Step 2: Document safety invariant**

Add: The sync script may only delete periods whose `kommentar` contains `[airbnb-inatur-sync]`; all other periods are treated as user-owned.

- [ ] **Step 3: Add verification command**

Use existing public availability endpoint after publish:

```bash
./ledige-dager.sh 1-1-2026 31-12-2026
```

Expected: dates covered by Airbnb bookings should no longer appear as available.

- [ ] **Step 4: Add iCal verification command**

After publish, fetch Inatur's iCal export and confirm expected blocked periods are represented:

```bash
curl --silent --show-error "$INATUR_AVAILABILITY_ICAL_URL" | head -40
```

Expected: calendar data is returned. Use this as a post-publish sanity check, not as the deletion source, because the authenticated offer JSON is the only source known to include the script ownership marker.

## Risks and Follow-Ups

- The refreshed-page HAR verifies `GET /min-side/tilbud/rediger/:draftId?spraak=no` as `200 application/json`, but terminal live calls still need a valid non-expired cookie/session.
- CSRF token source is not present in the exported HAR except as request headers. Initial implementation can require `INATUR_CSRF_TOKEN`; later implementation should extract it automatically.
- DST handling must stay covered by tests. The example period used October 2026 and matched `+02:00`; the plan also includes a January `+01:00` test.
- Full-offer `PUT` has a higher blast radius than a narrow endpoint. Always base changes on freshly fetched offer JSON and avoid editing unrelated fields.
- The Airbnb iCal URL fallback is explicitly approved for this local script. Avoid printing the token in logs, dry-run output, or test snapshots.
