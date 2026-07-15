const assert = require('node:assert/strict');
const test = require('node:test');
const { Timestamp } = require('@google-cloud/firestore');

const {
  FirestoreCookieStateStore,
  LockAlreadyHeldError
} = require('../../lib/state/firestore-cookie-state-store');

class FakeSnapshot {
  constructor(data) {
    this._data = data;
    this.exists = data !== null;
  }

  data() {
    return this._data ? { ...this._data } : null;
  }
}

class FakeDocRef {
  constructor() {
    this.value = null;
  }

  async get() {
    return new FakeSnapshot(this.value);
  }

  async set(data, options = {}) {
    this.value = options.merge ? { ...(this.value ?? {}), ...data } : { ...data };
  }

  async update(data) {
    this.value = { ...(this.value ?? {}) };
    for (const [key, value] of Object.entries(data)) {
      if (key === 'lock' && value?.constructor?.name === 'DeleteTransform') {
        delete this.value.lock;
      } else {
        this.value[key] = value;
      }
    }
  }
}

class FakeFirestore {
  constructor() {
    this.docRef = new FakeDocRef();
  }

  collection() {
    return { doc: () => this.docRef };
  }

  async runTransaction(fn) {
    const tx = {
      get: async (ref) => ref.get(),
      set: async (ref, data, options) => ref.set(data, options),
      update: async (ref, data) => ref.update(data)
    };
    return fn(tx);
  }
}

test('load returns empty state when firestore document does not exist', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreCookieStateStore({ firestore });

  assert.deepEqual(await store.load(), { sessionToken: null, cookies: [] });
});

test('save writes session token, cookies, and updatedAt', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreCookieStateStore({ firestore });

  await store.save({
    sessionToken: 'session-1',
    cookies: [{ name: 'session', value: 'session-1' }]
  });

  const data = firestore.docRef.value;
  assert.equal(data.sessionToken, 'session-1');
  assert.deepEqual(data.cookies, [{ name: 'session', value: 'session-1' }]);
  assert.equal(typeof data.updatedAt.toMillis, 'function');
});

test('withLock acquires and releases lock on success', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreCookieStateStore({ firestore, lockTtlSeconds: 60 });

  assert.equal(await store.withLock(async () => 'ok'), 'ok');
  assert.equal(firestore.docRef.value.lock, undefined);
});

test('withLock releases lock on error', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreCookieStateStore({ firestore, lockTtlSeconds: 60 });

  await assert.rejects(() => store.withLock(async () => {
    throw new Error('sync failed');
  }), /sync failed/);
  assert.equal(firestore.docRef.value.lock, undefined);
});

test('withLock rejects active lock', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreCookieStateStore({ firestore, lockTtlSeconds: 60 });
  await firestore.docRef.set({
    lock: {
      owner: 'other',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000)
    }
  });

  await assert.rejects(() => store.withLock(async () => 'ok'), LockAlreadyHeldError);
});

test('withLock takes over stale lock', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreCookieStateStore({ firestore, lockTtlSeconds: 60 });
  await firestore.docRef.set({
    lock: {
      owner: 'old',
      expiresAt: Timestamp.fromMillis(Date.now() - 60_000)
    }
  });

  assert.equal(await store.withLock(async () => 'ok'), 'ok');
  assert.equal(firestore.docRef.value.lock, undefined);
});

test('old owner cannot release a newer owner lock', async () => {
  const firestore = new FakeFirestore();
  const store = new FirestoreCookieStateStore({ firestore, lockTtlSeconds: 60 });

  await store.withLock(async () => {
    await firestore.docRef.set({
      lock: {
        owner: 'new-owner',
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000)
      }
    }, { merge: true });
  });

  assert.equal(firestore.docRef.value.lock.owner, 'new-owner');
});
