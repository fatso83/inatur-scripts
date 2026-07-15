# Google Cloud Firestore Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Airbnb-to-Inatur sync every 5 minutes on Google Cloud using Cloud Run, Cloud Scheduler, environment variables/secrets, and Firestore-backed cookie/session state while preserving the local CLI.

**Architecture:** Extract the sync execution into a reusable function with pluggable runtime state. Local CLI keeps using `.session-token.txt` and `cookies.json`; Cloud Run uses a Firestore document with the same logical fields. Cloud Scheduler invokes a private Cloud Run HTTP endpoint every 5 minutes, and Firestore transaction locking prevents overlapping syncs.

**Tech Stack:** Node.js, Playwright, Google Cloud Run, Cloud Scheduler, Firestore Native mode, Secret Manager/environment variables, Google Cloud CLI, Node built-in `node:test`.

---

## Current Context

Current `gcloud` configuration observed on 2026-07-08:

```text
account = carlerik@gmail.com
project = pilarr-stage-sql
region = europe-north1
zone = europe-north1-a
```

Target Google Cloud project:

```text
project id/name: inatur-synk
region: europe-north1
scheduler: every 5 minutes
```

The active `gcloud` project must be changed from `pilarr-stage-sql` to `inatur-synk` during setup.

## Cost Check

Expected monthly executions at `*/5 * * * *`:

```text
12/hour * 24/day * ~30 days = ~8640 executions/month
```

This should remain free or near-zero with normal runtime:

- Cloud Scheduler: one job, not billed per execution. First 3 jobs per billing account are free.
- Firestore: one small document read/write per run is far below 50,000 reads/day and 20,000 writes/day free quota.
- Cloud Run: should fit free tier if normal runs are short and Playwright login only happens on cookie refresh.

Use a Google Cloud budget alert anyway.

## Commit Policy

Before any task commit, ask for a Jira key. If no Jira key exists, ask whether to create a PD issue or commit without a Jira reference. The commit messages shown below are semantic examples; add the Jira scope when available, for example:

```bash
git commit -m "feat(PD-123): add firestore cookie state store"
```

## File Structure

Create:

- `lib/state/local-file-cookie-state-store.js`
  - Reads/writes `.session-token.txt` and `cookies.json`.
  - Used by local CLI.

- `lib/state/firestore-cookie-state-store.js`
  - Reads/writes a single Firestore document.
  - Stores `sessionToken`, `cookies`, `updatedAt`, and lock metadata.

- `lib/state/cloud-state-files.js`
  - Bridges Firestore state to the existing file-oriented `cookie-store`/Playwright scripts by materializing local temp files before a run and saving them back after a run.

- `lib/sync-runner.js`
  - Reusable `runSync(options)` implementation currently embedded in `sync-airbnb-inatur.js`.
  - No direct `process.argv`.
  - Accepts config, state paths, `publish`, and logger. Preview is the default when `publish` is false.

- `cloud-run-http.js`
  - Minimal HTTP server for Cloud Run.
  - Handles `POST /cron`.
  - Uses Firestore state store, obtains a short lock, runs publish sync, saves state, returns JSON.

- `Dockerfile`
  - Uses Playwright base image.
  - Installs dependencies and starts `cloud-run-http.js`.

- `scripts/gcloud/setup-inatur-synk.sh`
  - Creates/selects project, verifies billing, enables services, and creates Firestore.
  - Creates service accounts.

- `docs/google-cloud-run.md`
  - Operational docs: deploy, update secrets, manually trigger, inspect logs, disable scheduler.

Modify:

- `sync-airbnb-inatur.js`
  - Thin CLI wrapper around `runSync`.
  - Keeps existing flags.

- `lib/local-runtime.js`
  - Accept configurable token/cookie file paths via env/options.

- `cookie-store`
  - Replace fixed `.session-token.txt`/`cookies.json` with `INATUR_TOKEN_FILE` and `INATUR_COOKIES_FILE`.

- `fetch-or-refresh-session-token`
  - Replace fixed `cookies.json` with `INATUR_COOKIES_FILE`.

- `package.json`
  - Add dependencies for Firestore and HTTP server only if needed.
  - Add scripts for local cloud wrapper tests.

- `.env.sample`
  - Add Cloud Run/Firestore variables.

- `README.md`
  - Link to Google Cloud docs and describe local vs cloud state.

Tests:

- `test/state/local-file-cookie-state-store.test.js`
- `test/state/cloud-state-files.test.js`
- `test/sync-runner.test.js`
- `test/cloud-run-http.test.js`

## Environment Variables

Common:

```text
AIRBNB_ICAL_URL
INATUR_USER
INATUR_PASSWORD
INATUR_AKTIVTILBYDER
INATUR_SELLER_ID=63ee193639a4b03b97f009e9
INATUR_NODE_ID=63ee3bc2d0440d29d6c7ef45
INATUR_CARD_ID=63ee3ba9d0440d29d6c7ef44
INATUR_AVAILABILITY_ICAL_URL=https://www.inatur.no/api/external/v1/sales-pages/63ee3bc2d0440d29d6c7ef45/products/63ee3ba9d0440d29d6c7ef44/availability/ical
```

Local state:

```text
INATUR_TOKEN_FILE=.session-token.txt
INATUR_COOKIES_FILE=cookies.json
```

Cloud state:

```text
RUNTIME=google-cloud
GOOGLE_CLOUD_PROJECT=inatur-synk
FIRESTORE_DATABASE_ID=(default)
INATUR_STATE_COLLECTION=inaturSyncState
INATUR_STATE_DOCUMENT=holmevann
SYNC_LOCK_TTL_SECONDS=240
CRON_SHARED_SECRET=<optional fallback if IAM auth is not used>
```

## Task 1: Make Cookie File Paths Configurable

**Files:**
- Modify: `cookie-store`
- Modify: `fetch-or-refresh-session-token`
- Modify: `lib/local-runtime.js`
- Test: `test/local-runtime.test.js`

- [ ] **Step 1: Add failing test for custom cookie path**

Add to `test/local-runtime.test.js`:

```js
test('reads cookie jar from configured path', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-custom-cookies-'));
  const cookiePath = path.join(cwd, 'state', 'cookies.json');
  fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
  fs.writeFileSync(cookiePath, JSON.stringify([{ name: 'session', value: 'abc' }]));

  assert.deepEqual(readCookieJar({ cookiePath }), [{ name: 'session', value: 'abc' }]);
});
```

Also add a shell-level regression for `cookie-store validate` with an absolute custom token path. The current implementation uses `find . -name "$TOKENFILE"` and will not handle `/tmp/...` correctly.

```js
test('cookie-store validate accepts absolute custom token path', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'inatur-cookie-store-'));
  const tokenPath = path.join(cwd, 'state', '.session-token.txt');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, 'session-1\n');

  const result = childProcess.spawnSync(path.join(__dirname, '..', 'cookie-store'), ['validate'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, INATUR_TOKEN_FILE: tokenPath },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test
```

Expected: FAIL because `readCookieJar` does not accept `cookiePath`.

- [ ] **Step 3: Update `lib/local-runtime.js`**

Change:

```js
function readCookieJar({ cwd = process.cwd() } = {}) {
  const cookiePath = path.join(cwd, 'cookies.json');
```

To:

```js
function getCookiePath({ cwd = process.cwd(), env = process.env, cookiePath } = {}) {
  return cookiePath ?? env.INATUR_COOKIES_FILE ?? path.join(cwd, 'cookies.json');
}

function getTokenPath({ cwd = process.cwd(), env = process.env, tokenPath } = {}) {
  return tokenPath ?? env.INATUR_TOKEN_FILE ?? path.join(cwd, '.session-token.txt');
}

function readCookieJar(options = {}) {
  const cookiePath = getCookiePath(options);
```

Export `getCookiePath` and `getTokenPath`.

- [ ] **Step 4: Update `cookie-store`**

Replace:

```bash
TOKENFILE=".session-token.txt"
COOKIES_FILE="cookies.json"
```

With:

```bash
TOKENFILE="${INATUR_TOKEN_FILE:-.session-token.txt}"
COOKIES_FILE="${INATUR_COOKIES_FILE:-cookies.json}"
```

Also replace `invalidate-old()` with path-aware validation:

```bash
invalidate-old(){
    if [[ ! -f "$TOKENFILE" ]]; then
        delete-tokenfile
        return 1
    fi
    if [[ $(find "$TOKENFILE" -mmin -60 -type f -print -quit) == '' ]]; then
        delete-tokenfile
        return 1
    fi
}
```

- [ ] **Step 5: Update `fetch-or-refresh-session-token`**

Replace:

```js
const COOKIE_FILE = path.resolve(process.cwd(), "cookies.json");
```

With:

```js
const COOKIE_FILE = path.resolve(process.cwd(), process.env.INATUR_COOKIES_FILE || "cookies.json");
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cookie-store fetch-or-refresh-session-token lib/local-runtime.js test/local-runtime.test.js
git commit -m "feat: make inatur cookie state paths configurable"
```

## Task 2: Add Local Cookie State Store

**Files:**
- Create: `lib/state/local-file-cookie-state-store.js`
- Test: `test/state/local-file-cookie-state-store.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/state/local-file-cookie-state-store.test.js`:

```js
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
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test test/state/local-file-cookie-state-store.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement local store**

Create `lib/state/local-file-cookie-state-store.js`:

```js
const fs = require('node:fs/promises');
const path = require('node:path');

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

class LocalFileCookieStateStore {
  constructor({ tokenPath = '.session-token.txt', cookiePath = 'cookies.json' } = {}) {
    this.tokenPath = tokenPath;
    this.cookiePath = cookiePath;
  }

  async load() {
    const [sessionToken, cookieText] = await Promise.all([
      readTextIfExists(this.tokenPath),
      readTextIfExists(this.cookiePath)
    ]);

    return {
      sessionToken: sessionToken?.trim() || null,
      cookies: cookieText ? JSON.parse(cookieText) : []
    };
  }

  async save({ sessionToken, cookies }) {
    await fs.mkdir(path.dirname(this.tokenPath), { recursive: true });
    await fs.mkdir(path.dirname(this.cookiePath), { recursive: true });

    if (sessionToken) {
      await fs.writeFile(this.tokenPath, `${sessionToken}\n`);
    }
    await fs.writeFile(this.cookiePath, JSON.stringify(cookies ?? [], null, 2));
  }
}

module.exports = { LocalFileCookieStateStore };
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/state/local-file-cookie-state-store.js test/state/local-file-cookie-state-store.test.js
git commit -m "feat: add local cookie state store"
```

## Task 3: Bridge State Store to Existing File-Based Cookie Tools

**Files:**
- Create: `lib/state/cloud-state-files.js`
- Test: `test/state/cloud-state-files.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/state/cloud-state-files.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { materializeStateFiles, captureStateFiles } = require('../../lib/state/cloud-state-files');

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
```

Add a stale-file regression:

```js
test('materialize removes stale files for empty state', async () => {
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
```

- [ ] **Step 2: Implement bridge**

Create `lib/state/cloud-state-files.js` with `materializeStateFiles` and `captureStateFiles` using `fs/promises`.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/state/cloud-state-files.js test/state/cloud-state-files.test.js
git commit -m "feat: bridge cookie state stores to local files"
```

## Task 4: Extract Reusable Sync Runner

**Files:**
- Create: `lib/sync-runner.js`
- Modify: `sync-airbnb-inatur.js`
- Test: `test/sync-runner.test.js`
- Test: `test/sync-cli.test.js`

- [ ] **Step 1: Write runner tests**

Create `test/sync-runner.test.js` that verifies:

- `runSync({ publish: false })` formats preview output.
- `runSync({ publish: true })` does not call save when no changes.
- `runSync` accepts injected `readIcal`, `readEditableOffer`, `saveOffer`, `writeChangelog`, and `logger`.
- `runSync` accepts `env`, `cwd`, `tokenPath`, `cookiePath`, `ensureCookie`, `refreshCookie`, and `readCookieJar`.
- login redirect retry uses the configured `tokenPath`/`cookiePath`, not hard-coded cwd files.

- [ ] **Step 2: Extract code**

Move the body of `main()` in `sync-airbnb-inatur.js` into:

```js
async function runSync({
  publish = false,
  includeAirbnbUnavailable = false,
  offerFile = null,
  cwd = process.cwd(),
  env = process.env,
  tokenPath,
  cookiePath,
  ensureCookie,
  refreshCookie,
  readCookieJar,
  readIcal,
  readEditableOffer,
  saveOffer,
  writeChangelog,
  fetchAvailabilityIcal,
  config,
  logger = console
}) {
  // existing sync flow
}
```

Keep all current behavior:

- no publish with `--offer-file`
- skip `Airbnb (Not available)` unless explicitly included
- preserve manual blocks
- skip Airbnb bookings covered by manual `verdi: 0` blocks
- extract CSRF from edit page

- [ ] **Step 3: Make CLI a wrapper**

`sync-airbnb-inatur.js` should parse args and call `runSync`.

- [ ] **Step 4: Run CLI regression tests**

Run:

```bash
npm test
./sync-airbnb-inatur.js --from-file test/fixtures/airbnb-basic.ics --offer-file test/fixtures/inatur-offer-basic.json
```

Expected: tests pass and preview output remains unchanged. `--dry-run` must remain rejected unless a separate task intentionally restores it as an alias.

- [ ] **Step 5: Commit**

```bash
git add lib/sync-runner.js sync-airbnb-inatur.js test/sync-runner.test.js test/sync-cli.test.js
git commit -m "feat: extract reusable sync runner"
```

## Task 5: Add Firestore Cookie State Store

**Files:**
- Create: `lib/state/firestore-cookie-state-store.js`
- Test: `test/state/firestore-cookie-state-store.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add dependency**

Run:

```bash
npm install @google-cloud/firestore
```

- [ ] **Step 2: Write tests with fake Firestore**

Avoid emulator for unit tests. Use fake Firestore objects.

Test behaviors:

- `load()` returns `{ sessionToken: null, cookies: [] }` if document does not exist.
- `save()` writes `sessionToken`, `cookies`, `updatedAt`.
- `withLock(fn)` acquires lock in a Firestore transaction.
- `withLock(fn)` writes a random owner id and `expiresAt` as Firestore `Timestamp`.
- `withLock(fn)` releases lock on success and error only if `lock.owner` still equals its owner id.
- `withLock(fn)` rejects with a typed `LockAlreadyHeldError` if an existing lock is not expired.
- `withLock(fn)` can take over an expired lock.
- an old owner cannot release a newer owner lock after stale-lock takeover.

- [ ] **Step 3: Implement Firestore store**

Create `lib/state/firestore-cookie-state-store.js`:

```js
class FirestoreCookieStateStore {
  constructor({
    firestore,
    collection = process.env.INATUR_STATE_COLLECTION || 'inaturSyncState',
    document = process.env.INATUR_STATE_DOCUMENT || 'holmevann',
    lockTtlSeconds = Number(process.env.SYNC_LOCK_TTL_SECONDS || 240)
  }) {
    this.firestore = firestore;
    this.ref = firestore.collection(collection).doc(document);
    this.lockTtlSeconds = lockTtlSeconds;
  }

  async load() {}
  async save(state) {}
  async withLock(fn) {}
}
```

Lock document fields:

```json
{
  "lock": {
    "owner": "cloud-run-instance-or-random-id",
    "expiresAt": "<timestamp>"
  }
}
```

Required locking algorithm:

```text
transaction read document
if lock exists and lock.expiresAt > now: throw LockAlreadyHeldError
set lock.owner=randomUUID and lock.expiresAt=now+ttl with merge
run fn outside transaction
finally run release transaction:
  read document
  if current lock.owner === owner: delete lock field
  else leave document unchanged
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/state/firestore-cookie-state-store.js test/state/firestore-cookie-state-store.test.js
git commit -m "feat: add firestore cookie state store"
```

## Task 6: Add Cloud Run HTTP Entrypoint

**Files:**
- Create: `cloud-run-http.js`
- Test: `test/cloud-run-http.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write HTTP tests**

Test:

- `GET /healthz` returns `200`.
- `POST /cron` runs sync and returns JSON.
- `POST /cron` rejects if `CRON_SHARED_SECRET` is configured and header is missing.
- `POST /cron` returns `423` or `409` JSON when Firestore lock is held.
- `POST /cron` returns `500` JSON when sync fails.
- successful sync captures updated token/cookies and saves them to Firestore.
- failed sync releases lock but does not save corrupted or partially materialized state.

- [ ] **Step 2: Implement HTTP server using Node built-ins**

Avoid Express/YAGNI. Use `node:http`.

Server behavior:

```text
GET /healthz -> 200 ok
POST /cron -> run sync under Firestore lock
anything else -> 404
```

Authentication:

- Prefer Cloud Scheduler OIDC + Cloud Run IAM.
- Keep optional `CRON_SHARED_SECRET` check as defense-in-depth/local test path.

Cloud execution flow:

```text
load Firestore state
create a per-request temp dir with fs.mkdtemp('/tmp/inatur-state-')
materialize state to <tempdir>/.session-token.txt and <tempdir>/cookies.json
set INATUR_TOKEN_FILE and INATUR_COOKIES_FILE
run sync in publish mode
capture files back to state
save Firestore state
remove the temp dir in finally
return JSON summary
```

- [ ] **Step 3: Add npm script**

Modify `package.json`:

```json
{
  "scripts": {
    "start:cloud": "node cloud-run-http.js"
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud-run-http.js package.json test/cloud-run-http.test.js
git commit -m "feat: add cloud run cron endpoint"
```

## Task 7: Add Dockerfile

**Files:**
- Create: `Dockerfile`
- Create/modify: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

Include:

```text
.git
.env
.session-token.txt
cookies.json
inatur.har
node_modules
.worktrees
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.53.2-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
CMD ["npm", "run", "start:cloud"]
```

- [ ] **Step 3: Build locally**

Run:

```bash
docker build -t inatur-synk:local .
```

Expected: image builds.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add cloud run container"
```

## Task 8: Add Google Cloud Setup Script

**Files:**
- Create: `scripts/gcloud/setup-inatur-synk.sh`
- Create: `scripts/gcloud/deploy-inatur-synk.sh`
- Create: `scripts/gcloud/create-scheduler-inatur-synk.sh`
- Create: `scripts/gcloud/trigger-inatur-synk.sh`

- [ ] **Step 1: Create setup script**

The script should be explicit and safe. It should not store secret values in git.

`scripts/gcloud/setup-inatur-synk.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-inatur-synk}"
REGION="${REGION:-europe-north1}"
SERVICE_NAME="${SERVICE_NAME:-inatur-synk}"
SCHEDULER_NAME="${SCHEDULER_NAME:-inatur-synk-every-5-minutes}"
RUN_SA="inatur-synk-runner"
SCHEDULER_SA="inatur-synk-scheduler"

if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Project $PROJECT_ID already exists and is accessible"
else
  if ! gcloud projects create "$PROJECT_ID" --name="$PROJECT_ID"; then
    echo "Could not create project $PROJECT_ID. The ID may be taken globally or inaccessible." >&2
    echo "Try PROJECT_ID=inatur-synk-carlerik or inspect the project in Google Cloud Console." >&2
    exit 1
  fi
fi

echo "Attach billing manually if this fails:"
echo "  gcloud billing projects link $PROJECT_ID --billing-account <BILLING_ACCOUNT_ID>"
echo "Then re-run this setup script to enable services."

gcloud config set project "$PROJECT_ID"

if ! gcloud beta billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' | grep -q True; then
  echo "Billing is not enabled for $PROJECT_ID. Link billing before enabling services." >&2
  exit 1
fi

gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

gcloud firestore databases create \
  --database="(default)" \
  --location="$REGION" || true

gcloud iam service-accounts create "$RUN_SA" \
  --display-name="Inatur sync Cloud Run runtime" || true

gcloud iam service-accounts create "$SCHEDULER_SA" \
  --display-name="Inatur sync scheduler invoker" || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUN_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

- [ ] **Step 2: Create deploy script**

`scripts/gcloud/deploy-inatur-synk.sh` builds and deploys the service.

Use:

```bash
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --service-account "$RUN_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --no-allow-unauthenticated \
  --max-instances 1 \
  --concurrency 1 \
  --timeout 300 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars "RUNTIME=google-cloud,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,FIRESTORE_DATABASE_ID=(default),INATUR_STATE_COLLECTION=inaturSyncState,INATUR_STATE_DOCUMENT=holmevann,SYNC_LOCK_TTL_SECONDS=240,INATUR_AKTIVTILBYDER=63ee193639a4b03b97f009e9,INATUR_SELLER_ID=63ee193639a4b03b97f009e9,INATUR_NODE_ID=63ee3bc2d0440d29d6c7ef45,INATUR_CARD_ID=63ee3ba9d0440d29d6c7ef44" \
  --set-secrets "INATUR_USER=INATUR_USER:latest,INATUR_PASSWORD=INATUR_PASSWORD:latest,AIRBNB_ICAL_URL=AIRBNB_ICAL_URL:latest"
```

Then grant scheduler invoker:

```bash
gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --region "$REGION" \
  --member="serviceAccount:$SCHEDULER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

- [ ] **Step 3: Create scheduler script**

Create `scripts/gcloud/create-scheduler-inatur-synk.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-inatur-synk}"
REGION="${REGION:-europe-north1}"
SERVICE_NAME="${SERVICE_NAME:-inatur-synk}"
SCHEDULER_NAME="${SCHEDULER_NAME:-inatur-synk-every-5-minutes}"
SCHEDULER_SA="inatur-synk-scheduler"

gcloud config set project "$PROJECT_ID"
SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

gcloud scheduler jobs create http "$SCHEDULER_NAME" \
  --location "$REGION" \
  --schedule "*/5 * * * *" \
  --uri "$SERVICE_URL/cron" \
  --http-method POST \
  --oidc-service-account-email "$SCHEDULER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --oidc-token-audience "$SERVICE_URL"
```

- [ ] **Step 4: Create trigger script**

Create `scripts/gcloud/trigger-inatur-synk.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-inatur-synk}"
REGION="${REGION:-europe-north1}"
SCHEDULER_NAME="${SCHEDULER_NAME:-inatur-synk-every-5-minutes}"

gcloud config set project "$PROJECT_ID"
gcloud scheduler jobs run "$SCHEDULER_NAME" --location "$REGION"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/gcloud
git commit -m "ops: add google cloud setup scripts"
```

## Task 9: Configure Secrets and Environment

**Files:**
- Modify: `.env.sample`
- Modify: `docs/google-cloud-run.md`

- [ ] **Step 1: Add documentation for required secrets**

Document:

```bash
printf '%s' "$INATUR_USER" | gcloud secrets create INATUR_USER --data-file=-
printf '%s' "$INATUR_PASSWORD" | gcloud secrets create INATUR_PASSWORD --data-file=-
printf '%s' "$AIRBNB_ICAL_URL" | gcloud secrets create AIRBNB_ICAL_URL --data-file=-
```

And update service:

```bash
gcloud run services update inatur-synk \
  --region europe-north1 \
  --update-secrets INATUR_USER=INATUR_USER:latest,INATUR_PASSWORD=INATUR_PASSWORD:latest,AIRBNB_ICAL_URL=AIRBNB_ICAL_URL:latest
```

- [ ] **Step 2: Verify Cloud Run bindings**

Document that `deploy-inatur-synk.sh` binds the required secrets and normal env vars. If secrets are created or rotated after deployment, run:

```bash
gcloud run services update inatur-synk \
  --region europe-north1 \
  --update-secrets INATUR_USER=INATUR_USER:latest,INATUR_PASSWORD=INATUR_PASSWORD:latest,AIRBNB_ICAL_URL=AIRBNB_ICAL_URL:latest
```

- [ ] **Step 3: Commit**

```bash
git add .env.sample docs/google-cloud-run.md
git commit -m "docs: document google cloud secrets"
```

## Task 10: Seed Firestore State From Local Cookies

**Files:**
- Create: `scripts/gcloud/seed-firestore-state.js`
- Test: optional unit test around serialization helper

- [ ] **Step 1: Create seed script**

The script reads local `.session-token.txt` and `cookies.json` and writes:

```json
{
  "sessionToken": "...",
  "cookies": [...],
  "updatedAt": "<server timestamp>"
}
```

To:

```text
inaturSyncState/holmevann
```

- [ ] **Step 2: Run seed script locally**

Run:

```bash
GOOGLE_CLOUD_PROJECT=inatur-synk node scripts/gcloud/seed-firestore-state.js
```

Expected: Firestore document is created.

- [ ] **Step 3: Commit**

```bash
git add scripts/gcloud/seed-firestore-state.js
git commit -m "ops: add firestore state seed script"
```

## Task 11: Deploy and Smoke Test

**Files:**
- No code changes expected unless smoke test finds issues.

- [ ] **Step 1: Create/select project and link billing**

Run:

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/setup-inatur-synk.sh
```

If project creation fails because the ID is taken, stop and ask whether to use:

```text
inatur-synk-carlerik
```

- [ ] **Step 2: Link billing if setup stops for missing billing**

Run:

```bash
gcloud billing accounts list
gcloud billing projects link inatur-synk --billing-account <BILLING_ACCOUNT_ID>
```

Then re-run:

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/setup-inatur-synk.sh
```

- [ ] **Step 3: Create secrets before deploy**

Use local `.env` values, but do not print them.

- [ ] **Step 4: Deploy service**

Run:

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/deploy-inatur-synk.sh
```

- [ ] **Step 5: Seed Firestore**

Run:

```bash
GOOGLE_CLOUD_PROJECT=inatur-synk node scripts/gcloud/seed-firestore-state.js
```

- [ ] **Step 6: Manually invoke Cloud Run once**

Run:

```bash
SERVICE_URL="$(gcloud run services describe inatur-synk --region europe-north1 --format='value(status.url)')"
curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$SERVICE_URL/cron"
```

Expected:

```json
{
  "ok": true,
  "dryRun": false
}
```

If local user token is not authorized to invoke the service, use:

```bash
gcloud run services proxy inatur-synk --region europe-north1
curl -X POST http://localhost:8080/cron
```

- [ ] **Step 7: Create scheduler job**

Run:

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/create-scheduler-inatur-synk.sh
```

- [ ] **Step 8: Force scheduler run**

Run:

```bash
PROJECT_ID=inatur-synk REGION=europe-north1 ./scripts/gcloud/trigger-inatur-synk.sh
```

- [ ] **Step 9: Inspect logs**

Run:

```bash
gcloud run services logs read inatur-synk --region europe-north1 --limit 100
```

Expected:

```text
No changes
```

Or a clear diff with successful publish.

## Task 12: Documentation and Operational Controls

**Files:**
- Modify: `README.md`
- Modify: `docs/google-cloud-run.md`

- [ ] **Step 1: Document pause/resume**

```bash
gcloud scheduler jobs pause inatur-synk-every-5-minutes --location europe-north1
gcloud scheduler jobs resume inatur-synk-every-5-minutes --location europe-north1
```

- [ ] **Step 2: Document manual trigger**

```bash
gcloud scheduler jobs run inatur-synk-every-5-minutes --location europe-north1
```

- [ ] **Step 3: Document rollback**

```bash
gcloud run revisions list --service inatur-synk --region europe-north1
gcloud run services update-traffic inatur-synk --region europe-north1 --to-revisions REVISION=100
```

- [ ] **Step 4: Document cost guard**

Set a Google Cloud budget alert for `inatur-synk`, e.g. NOK 10/month.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/google-cloud-run.md
git commit -m "docs: add google cloud run operations"
```

## Final Verification Checklist

- [ ] `npm test` passes.
- [ ] Local preview works.
- [ ] Local `--publish` still works.
- [ ] Firestore seed script writes `inaturSyncState/holmevann`.
- [ ] Cloud Run `/healthz` returns 200.
- [ ] Cloud Run `/cron` manually runs once.
- [ ] Scheduler is configured as `*/5 * * * *`.
- [ ] Scheduler manual run succeeds.
- [ ] Logs show no secret values.
- [ ] Cloud Run has `max-instances=1` and `concurrency=1`.
- [ ] Firestore lock prevents overlapping runs.
- [ ] Budget alert exists.

## Risks and Decisions

- Playwright in Cloud Run can be slower on cold start. Use the Playwright base image and keep timeout at 300 seconds.
- Do not refresh cookies on every run. Let `cookie-store validate` avoid unnecessary Playwright logins.
- Firestore state contains sensitive session cookies. Restrict access to only the Cloud Run runtime service account and project owners.
- `inatur-synk` project ID may already be taken globally. If so, use `inatur-synk-carlerik`.
- `gcloud` logs may fail locally if `~/.config/gcloud/logs` is not writable in the sandbox; this does not necessarily block actual GCP setup outside the sandbox.
