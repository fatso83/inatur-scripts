const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Firestore } = require('@google-cloud/firestore');
const { runSync } = require('./lib/sync-runner');
const { captureStateFiles, materializeStateFiles } = require('./lib/state/cloud-state-files');
const {
  FirestoreCookieStateStore,
  LockAlreadyHeldError
} = require('./lib/state/firestore-cookie-state-store');

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function isAuthorized(request, env) {
  if (!env.CRON_SHARED_SECRET) return true;
  return request.headers['x-cron-secret'] === env.CRON_SHARED_SECRET;
}

async function runCron({ stateStore, runSyncFn, env, cwd }) {
  return stateStore.withLock(async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inatur-state-'));
    try {
      const tokenPath = path.join(tempDir, '.session-token.txt');
      const cookiePath = path.join(tempDir, 'cookies.json');
      const state = await stateStore.load();
      await materializeStateFiles({ tokenPath, cookiePath, state });

      const result = await runSyncFn({
        publish: true,
        cwd,
        env,
        tokenPath,
        cookiePath
      });

      const nextState = await captureStateFiles({ tokenPath, cookiePath });
      await stateStore.save(nextState);
      return result;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}

function createCloudRunServer({
  stateStore,
  runSync: runSyncFn = runSync,
  env = process.env,
  cwd = process.cwd()
}) {
  if (!stateStore) throw new Error('createCloudRunServer requires stateStore');

  return http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && (request.url === '/healthz' || request.url === '/_healthz')) {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('ok');
        return;
      }

      if (request.method !== 'POST' || request.url !== '/cron') {
        sendJson(response, 404, { ok: false, error: 'not found' });
        return;
      }

      if (!isAuthorized(request, env)) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const result = await runCron({ stateStore, runSyncFn, env, cwd });
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      if (error instanceof LockAlreadyHeldError) {
        sendJson(response, 423, { ok: false, error: error.message });
        return;
      }
      sendJson(response, 500, { ok: false, error: error.message });
    }
  });
}

function createProductionStateStore(env = process.env) {
  const firestore = new Firestore({
    projectId: env.GOOGLE_CLOUD_PROJECT,
    databaseId: env.FIRESTORE_DATABASE_ID || '(default)'
  });
  return new FirestoreCookieStateStore({ firestore });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  const server = createCloudRunServer({
    stateStore: createProductionStateStore()
  });
  server.listen(port, () => {
    console.log(`inatur-synk listening on ${port}`);
  });
}

module.exports = { createCloudRunServer, createProductionStateStore, runCron };
