const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LocalFileCookieStateStore } = require('../../lib/state/local-file-cookie-state-store');

test('loads missing local state as empty values', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-local-state-'));
  const store = new LocalFileCookieStateStore({
    tokenPath: path.join(cwd, '.session-token.txt'),
    cookiePath: path.join(cwd, 'cookies.json')
  });

  assert.deepEqual(await store.load(), { sessionToken: null, cookies: [] });
});

test('saves and reloads local state', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-local-state-'));
  const store = new LocalFileCookieStateStore({
    tokenPath: path.join(cwd, '.session-token.txt'),
    cookiePath: path.join(cwd, 'cookies.json')
  });

  await store.save({
    sessionToken: 'session-1',
    cookies: [{ name: 'session', value: 'session-1' }]
  });

  assert.deepEqual(await store.load(), {
    sessionToken: 'session-1',
    cookies: [{ name: 'session', value: 'session-1' }]
  });
});
