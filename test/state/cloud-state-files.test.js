const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { captureStateFiles, materializeStateFiles } = require('../../lib/state/cloud-state-files');

test('materializes state into token and cookie files', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-state-files-'));
  const tokenPath = path.join(cwd, '.state', '.session-token.txt');
  const cookiePath = path.join(cwd, '.state', 'cookies.json');

  await materializeStateFiles({
    tokenPath,
    cookiePath,
    state: {
      sessionToken: 'session-1',
      cookies: [{ name: 'session', value: 'session-1' }]
    }
  });

  assert.equal(fs.readFileSync(tokenPath, 'utf8'), 'session-1\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(cookiePath, 'utf8')), [{ name: 'session', value: 'session-1' }]);
});

test('captures state from token and cookie files', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-state-files-'));
  const tokenPath = path.join(cwd, '.session-token.txt');
  const cookiePath = path.join(cwd, 'cookies.json');
  fs.writeFileSync(tokenPath, 'session-2\n');
  fs.writeFileSync(cookiePath, JSON.stringify([{ name: 'session', value: 'session-2' }]));

  assert.deepEqual(await captureStateFiles({ tokenPath, cookiePath }), {
    sessionToken: 'session-2',
    cookies: [{ name: 'session', value: 'session-2' }]
  });
});

test('materialize removes stale token file and writes empty cookies for empty state', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-state-files-'));
  const tokenPath = path.join(cwd, '.session-token.txt');
  const cookiePath = path.join(cwd, 'cookies.json');
  fs.writeFileSync(tokenPath, 'old\n');
  fs.writeFileSync(cookiePath, '[{"name":"old","value":"cookie"}]');

  await materializeStateFiles({
    tokenPath,
    cookiePath,
    state: { sessionToken: null, cookies: [] }
  });

  assert.equal(fs.existsSync(tokenPath), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(cookiePath, 'utf8')), []);
});
