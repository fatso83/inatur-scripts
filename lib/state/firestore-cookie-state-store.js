const { randomUUID } = require('node:crypto');
const { FieldValue, Timestamp } = require('@google-cloud/firestore');

class LockAlreadyHeldError extends Error {
  constructor(message = 'Sync lock is already held') {
    super(message);
    this.name = 'LockAlreadyHeldError';
  }
}

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

class FirestoreCookieStateStore {
  constructor({
    firestore,
    collection = process.env.INATUR_STATE_COLLECTION || 'inaturSyncState',
    document = process.env.INATUR_STATE_DOCUMENT || 'holmevann',
    lockTtlSeconds = Number(process.env.SYNC_LOCK_TTL_SECONDS || 240),
    now = () => Date.now(),
    ownerFactory = randomUUID
  }) {
    if (!firestore) throw new Error('FirestoreCookieStateStore requires firestore');
    this.firestore = firestore;
    this.ref = firestore.collection(collection).doc(document);
    this.lockTtlSeconds = lockTtlSeconds;
    this.now = now;
    this.ownerFactory = ownerFactory;
  }

  async load() {
    const snapshot = await this.ref.get();
    if (!snapshot.exists) {
      return { sessionToken: null, cookies: [] };
    }

    const data = snapshot.data() ?? {};
    return {
      sessionToken: data.sessionToken ?? null,
      cookies: Array.isArray(data.cookies) ? data.cookies : []
    };
  }

  async save({ sessionToken, cookies }) {
    await this.ref.set({
      sessionToken: sessionToken ?? null,
      cookies: cookies ?? [],
      updatedAt: Timestamp.now()
    }, { merge: true });
  }

  async acquireLock(owner) {
    const expiresAt = Timestamp.fromMillis(this.now() + this.lockTtlSeconds * 1000);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.ref);
      const data = snapshot.exists ? snapshot.data() ?? {} : {};
      const lock = data.lock;
      if (lock?.owner && timestampToMillis(lock.expiresAt) > this.now()) {
        throw new LockAlreadyHeldError();
      }

      await transaction.set(this.ref, {
        lock: { owner, expiresAt }
      }, { merge: true });
    });
  }

  async releaseLock(owner) {
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.ref);
      if (!snapshot.exists) return;

      const lock = snapshot.data()?.lock;
      if (lock?.owner === owner) {
        await transaction.update(this.ref, { lock: FieldValue.delete() });
      }
    });
  }

  async withLock(fn) {
    const owner = this.ownerFactory();
    await this.acquireLock(owner);
    try {
      return await fn({ owner });
    } finally {
      await this.releaseLock(owner);
    }
  }
}

module.exports = { FirestoreCookieStateStore, LockAlreadyHeldError };
