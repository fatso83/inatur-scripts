const assert = require('node:assert/strict');
const test = require('node:test');

const { runSync } = require('../lib/sync-runner');

function makeOffer(periods = []) {
  return {
    id: 'offer-1',
    kort: [
      {
        id: 'card-1',
        antall: {
          perioder: periods
        }
      }
    ]
  };
}

const oneReservedStayIcal = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261020',
  'DTEND;VALUE=DATE:20261022',
  'SUMMARY:Reserved',
  'UID:airbnb-example-1',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\n');

test('runSync previews add actions without saving', async () => {
  const lines = [];
  const result = await runSync({
    publish: false,
    readIcal: async () => oneReservedStayIcal,
    readOfferFromFile: async () => makeOffer([]),
    offerFile: 'fixture.json',
    config: { cardId: 'card-1', nodeId: 'node-1' },
    logger: { log: (message) => lines.push(message) }
  });

  assert.equal(result.publish, false);
  assert.equal(result.add, 1);
  assert.match(lines.join('\n'), /Forhandsvisning/);
  assert.match(lines.join('\n'), /vil legge til sperring 20\.10\.2026 -> 21\.10\.2026/);
});

test('runSync does not save when publish has no changes', async () => {
  let saveCalls = 0;
  const result = await runSync({
    publish: true,
    readIcal: async () => oneReservedStayIcal,
    readEditableOffer: async () => ({
      editOfferId: 'edit-1',
      offer: makeOffer([
        {
          fra: 1792447200000,
          til: 1792533600000,
          kommentar: '[airbnb-inatur-sync] uid=airbnb-example-1',
          fraFormatert: '20.10.2026',
          tilFormatert: '21.10.2026',
          verdi: 0
        }
      ]),
      csrfToken: 'csrf-1'
    }),
    ensureCookie: async () => 'session=abc',
    readCookieJar: () => [{ name: 'session', value: 'abc' }],
    saveOffer: async () => { saveCalls += 1; },
    writeChangelog: async () => {},
    config: { cardId: 'card-1', nodeId: 'node-1', sellerId: 'seller-1' },
    logger: { log: () => {} }
  });

  assert.equal(result.add, 0);
  assert.equal(result.remove, 0);
  assert.equal(saveCalls, 0);
});

test('runSync retries with configured state paths on login redirect', async () => {
  const calls = [];
  let attempt = 0;

  const result = await runSync({
    publish: false,
    cwd: '/tmp/project',
    env: { AIRBNB_ICAL_URL: 'https://example.test/ical' },
    tokenPath: '/tmp/state/.session-token.txt',
    cookiePath: '/tmp/state/cookies.json',
    readIcal: async () => oneReservedStayIcal,
    ensureCookie: async (options) => calls.push(['ensure', options]),
    refreshCookie: async (options) => calls.push(['refresh', options]),
    readCookieJar: (options) => {
      calls.push(['readJar', options]);
      return [{ name: 'session', value: 'abc' }];
    },
    readEditableOffer: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Inatur session redirected to login');
      return {
        editOfferId: 'edit-1',
        offer: makeOffer([]),
        csrfToken: 'csrf-1'
      };
    },
    config: { cardId: 'card-1', nodeId: 'node-1', sellerId: 'seller-1' },
    logger: { log: () => {} }
  });

  assert.equal(result.add, 1);
  assert.equal(calls[0][0], 'ensure');
  assert.equal(calls[0][1].env.INATUR_TOKEN_FILE, '/tmp/state/.session-token.txt');
  assert.equal(calls[0][1].env.INATUR_COOKIES_FILE, '/tmp/state/cookies.json');
  assert.equal(calls.some(([name]) => name === 'refresh'), true);
  assert.equal(calls.filter(([name]) => name === 'readJar').length, 2);
});

test('runSync reads Airbnb iCal from environment when no reader is injected', async () => {
  const fetches = [];
  const result = await runSync({
    publish: false,
    env: { AIRBNB_ICAL_URL: 'https://example.test/airbnb.ics' },
    fetchIcal: async (url) => {
      fetches.push(url);
      return oneReservedStayIcal;
    },
    readOfferFromFile: async () => makeOffer([]),
    offerFile: 'fixture.json',
    config: { cardId: 'card-1', nodeId: 'node-1' },
    logger: { log: () => {} }
  });

  assert.deepEqual(fetches, ['https://example.test/airbnb.ics']);
  assert.equal(result.add, 1);
});
