const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');

const { createCloudRunServer } = require('../cloud-run-http');
const { LockAlreadyHeldError } = require('../lib/state/firestore-cookie-state-store');

async function withTestServer(server, fn) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

class FakeStateStore {
  constructor(state = { sessionToken: null, cookies: [] }) {
    this.state = state;
    this.saved = [];
    this.lockReleased = false;
    this.lockError = null;
  }

  async load() {
    return this.state;
  }

  async save(state) {
    this.saved.push(state);
    this.state = state;
  }

  async withLock(fn) {
    if (this.lockError) throw this.lockError;
    try {
      return await fn();
    } finally {
      this.lockReleased = true;
    }
  }
}

test('GET /healthz and /_healthz return ok', async () => {
  const server = createCloudRunServer({
    stateStore: new FakeStateStore(),
    runSync: async () => ({ ok: true }),
    env: {}
  });

  await withTestServer(server, async (url) => {
    for (const path of ['/healthz', '/_healthz']) {
      const response = await fetch(`${url}${path}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'ok');
    }
  });
});

test('POST /cron rejects missing shared secret', async () => {
  const server = createCloudRunServer({
    stateStore: new FakeStateStore(),
    runSync: async () => ({ ok: true }),
    env: { CRON_SHARED_SECRET: 'secret-1' }
  });

  await withTestServer(server, async (url) => {
    const response = await fetch(`${url}/cron`, { method: 'POST' });
    assert.equal(response.status, 401);
  });
});

test('POST /cron materializes state, runs sync, captures state, and returns JSON', async () => {
  const stateStore = new FakeStateStore({
    sessionToken: 'old-session',
    cookies: [{ name: 'session', value: 'old-session' }]
  });
  const seen = {};
  const server = createCloudRunServer({
    stateStore,
    env: {},
    runSync: async (options) => {
      seen.options = options;
      await fs.writeFile(options.tokenPath, 'new-session\n');
      await fs.writeFile(options.cookiePath, JSON.stringify([{ name: 'session', value: 'new-session' }]));
      return { publish: true, add: 0, remove: 0 };
    }
  });

  await withTestServer(server, async (url) => {
    const response = await fetch(`${url}/cron`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      result: { publish: true, add: 0, remove: 0 }
    });
  });

  assert.equal(seen.options.publish, true);
  assert.match(seen.options.tokenPath, /inatur-state-/);
  assert.equal(stateStore.saved.length, 1);
  assert.deepEqual(stateStore.saved[0], {
    sessionToken: 'new-session',
    cookies: [{ name: 'session', value: 'new-session' }]
  });
  assert.equal(stateStore.lockReleased, true);
});

test('POST /cron returns 423 when lock is held', async () => {
  const stateStore = new FakeStateStore();
  stateStore.lockError = new LockAlreadyHeldError();
  const server = createCloudRunServer({
    stateStore,
    runSync: async () => {
      throw new Error('should not run');
    },
    env: {}
  });

  await withTestServer(server, async (url) => {
    const response = await fetch(`${url}/cron`, { method: 'POST' });
    assert.equal(response.status, 423);
    assert.equal((await response.json()).ok, false);
  });
});

test('POST /cron returns 500 and does not save state when sync fails', async () => {
  const stateStore = new FakeStateStore();
  const server = createCloudRunServer({
    stateStore,
    runSync: async () => {
      throw new Error('sync failed');
    },
    env: {}
  });

  await withTestServer(server, async (url) => {
    const response = await fetch(`${url}/cron`, { method: 'POST' });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /sync failed/);
  });

  assert.deepEqual(stateStore.saved, []);
  assert.equal(stateStore.lockReleased, true);
});
