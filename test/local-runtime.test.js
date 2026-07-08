const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  applySetCookieHeader,
  cookieJarToHeader,
  DEFAULT_AIRBNB_ICAL_URL,
  ensureInaturCookie,
  loadDotEnv,
  parseCookieExport,
  readCookieJar,
  refreshInaturCookie
} = require('../lib/local-runtime');

test('loads .env values without overriding existing env', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-env-'));
  fs.writeFileSync(path.join(cwd, '.env'), [
    'export INATUR_AKTIVTILBYDER="seller-1"',
    'AIRBNB_ICAL_URL="https://example.test/calendar.ics"',
    ''
  ].join('\n'));

  const env = { AIRBNB_ICAL_URL: 'already-set' };
  loadDotEnv({ cwd, env });

  assert.equal(env.INATUR_AKTIVTILBYDER, 'seller-1');
  assert.equal(env.AIRBNB_ICAL_URL, 'already-set');
});

test('parses cookie-store export output', () => {
  assert.equal(
    parseCookieExport("export INATUR_COOKIE='session=abc; aktivTilbyder=seller-1'\n"),
    'session=abc; aktivTilbyder=seller-1'
  );
});

test('refreshes and exports cookie when no cookie exists', (t) => {
  const calls = [];
  t.mock.method(childProcess, 'execFileSync', (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (args[0] === 'validate') {
      throw new Error('old cookie');
    }
    if (args[0] === 'export') {
      return "export INATUR_COOKIE='session=fresh; aktivTilbyder=seller-1'\n";
    }
    return '';
  });

  const env = { INATUR_AKTIVTILBYDER: 'seller-1' };
  assert.equal(ensureInaturCookie({ cwd: '/tmp/project', env }), 'session=fresh; aktivTilbyder=seller-1');
  assert.deepEqual(calls.map((call) => call.args[0]), ['validate', 'refresh', 'export']);
  assert.equal(env.INATUR_COOKIE, 'session=fresh; aktivTilbyder=seller-1');
});

test('can force refresh and export cookie', (t) => {
  const calls = [];
  t.mock.method(childProcess, 'execFileSync', (cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'export') {
      return "export INATUR_COOKIE='session=forced; aktivTilbyder=seller-1'\n";
    }
    return '';
  });

  const env = { INATUR_AKTIVTILBYDER: 'seller-1', INATUR_COOKIE: 'session=old' };
  assert.equal(refreshInaturCookie({ cwd: '/tmp/project', env }), 'session=forced; aktivTilbyder=seller-1');
  assert.deepEqual(calls, ['refresh', 'export']);
  assert.equal(env.INATUR_COOKIE, 'session=forced; aktivTilbyder=seller-1');
});

test('reads full browser cookie jar and builds cookie header', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-cookies-'));
  fs.writeFileSync(path.join(cwd, 'cookies.json'), JSON.stringify([
    { name: 'session', value: 'abc' },
    { name: 'KEYCLOAK_IDENTITY', value: 'identity-1' },
    { name: 'aktivTilbyder', value: 'seller-1' }
  ]));

  const jar = readCookieJar({ cwd });
  assert.equal(
    cookieJarToHeader(jar),
    'session=abc; KEYCLOAK_IDENTITY=identity-1; aktivTilbyder=seller-1'
  );
});

test('applies set-cookie values by replacing existing cookie names', () => {
  const jar = [
    { name: 'session', value: 'abc' },
    { name: 'aktivTilbyder', value: 'old-seller' }
  ];

  applySetCookieHeader(
    jar,
    'aktivTilbyder=new-seller; Path=/; HttpOnly, other=value; Expires=Tue, 07 Jul 2026 10:00:00 GMT; Path=/'
  );

  assert.deepEqual(jar, [
    { name: 'session', value: 'abc' },
    { name: 'aktivTilbyder', value: 'new-seller' },
    { name: 'other', value: 'value' }
  ]);
});

test('has the approved Airbnb fallback URL', () => {
  assert.equal(
    DEFAULT_AIRBNB_ICAL_URL,
    'https://www.airbnb.no/calendar/ical/18731440.ics?s=dff56d4150cc69b4dca45191401cefbd'
  );
});
