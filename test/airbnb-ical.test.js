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

test('can include Airbnb not-available blocks when explicitly requested', () => {
  const ics = fs.readFileSync(path.join(__dirname, 'fixtures/airbnb-basic.ics'), 'utf8');

  assert.deepEqual(parseAirbnbIcal(ics, { includeUnavailable: true }), [
    {
      uid: 'airbnb-example-1',
      startDate: '2026-10-20',
      endDateExclusive: '2026-10-22',
      summary: 'Reserved'
    },
    {
      uid: 'airbnb-unavailable-window',
      startDate: '2027-04-03',
      endDateExclusive: '2027-07-08',
      summary: 'Airbnb (Not available)'
    }
  ]);
});
