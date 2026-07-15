#!/usr/bin/env node

const { Firestore } = require('@google-cloud/firestore');
const { loadDotEnv, getCookiePath, getTokenPath } = require('../../lib/local-runtime');
const { LocalFileCookieStateStore } = require('../../lib/state/local-file-cookie-state-store');
const { FirestoreCookieStateStore } = require('../../lib/state/firestore-cookie-state-store');

async function main() {
  loadDotEnv();

  const firestore = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
  });
  const localStore = new LocalFileCookieStateStore({
    tokenPath: getTokenPath(),
    cookiePath: getCookiePath()
  });
  const firestoreStore = new FirestoreCookieStateStore({ firestore });
  const state = await localStore.load();

  await firestoreStore.save(state);
  console.log(JSON.stringify({
    ok: true,
    cookies: state.cookies.length,
    hasSessionToken: Boolean(state.sessionToken),
    collection: process.env.INATUR_STATE_COLLECTION || 'inaturSyncState',
    document: process.env.INATUR_STATE_DOCUMENT || 'holmevann'
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
