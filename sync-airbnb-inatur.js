#!/usr/bin/env node

const fs = require('node:fs/promises');
const { parseAirbnbIcal } = require('./lib/airbnb-ical');
const {
  buildKortChangelog,
  buildPublishChangelog,
  buildScriptPeriod,
  getTargetCard,
  updateOfferPeriods
} = require('./lib/inatur-offer');
const { createSyncDiff, formatSyncPlan } = require('./lib/sync-diff');
const {
  DEFAULT_AIRBNB_ICAL_URL,
  cookieJarToHeader,
  ensureInaturCookie,
  loadDotEnv,
  readCookieJar,
  refreshInaturCookie
} = require('./lib/local-runtime');
const {
  fetchEditableOffer,
  fetchText,
  saveOffer,
  writeChangelog
} = require('./lib/inatur-client');

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function validateArgs(args = process.argv.slice(2)) {
  const optionsWithValue = new Set(['--from-file', '--ical-url', '--offer-file']);
  const booleanOptions = new Set(['--publish', '--include-airbnb-unavailable', '--help', '-h']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    if (booleanOptions.has(arg)) continue;
    if (optionsWithValue.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
}

function printHelp() {
  console.log(`Usage: sync-airbnb-inatur.js [options]

Sync Airbnb reservations to Inatur blocked periods. By default, the script only previews changes.

Options:
  --publish                         Save and publish changes in Inatur.
  --from-file <path>                Read Airbnb iCal from a local file instead of URL.
  --ical-url <url>                  Read Airbnb iCal from this URL instead of AIRBNB_ICAL_URL/default.
  --offer-file <path>               Read Inatur offer JSON from a local file for offline preview.
  --include-airbnb-unavailable      Also sync Airbnb "Not available" blocks. By default only Reserved events sync.
  --help, -h                        Show this help text.

Environment:
  AIRBNB_ICAL_URL                   Optional; overrides built-in Airbnb iCal fallback.
  INATUR_SELLER_ID                  Optional; defaults to Holmevann seller id.
  INATUR_NODE_ID                    Optional; defaults to Holmevann sales page id.
  INATUR_CARD_ID                    Optional; defaults to Holmevann product/card id.
  INATUR_AVAILABILITY_ICAL_URL      Optional; fetched after publish as a sanity check.

Authentication:
  Inatur cookies are handled by ./cookie-store and cookies.json.
  CSRF token is extracted automatically from the Inatur edit page.`);
}

async function readIcal() {
  const file = getArg('--from-file');
  if (file) return fs.readFile(file, 'utf8');

  const url = getArg('--ical-url') ?? process.env.AIRBNB_ICAL_URL ?? DEFAULT_AIRBNB_ICAL_URL;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from Airbnb iCal URL`);
  return response.text();
}

async function readOfferFromFile() {
  const offerFile = getArg('--offer-file');
  return JSON.parse(await fs.readFile(offerFile, 'utf8'));
}

async function withRefreshedCookieOnLogin(fn) {
  try {
    return await fn();
  } catch (error) {
    if (!/Inatur session redirected to login/.test(error.message)) {
      throw error;
    }
    refreshInaturCookie();
    return fn();
  }
}

function hasChanges(diff) {
  return diff.add.length > 0 || diff.remove.length > 0;
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    return;
  }

  validateArgs();
  loadDotEnv();

  const shouldPublish = hasFlag('--publish');
  const offerFile = getArg('--offer-file');
  if (shouldPublish && offerFile) {
    throw new Error('Refusing --publish with --offer-file; --offer-file is for offline preview only.');
  }

  if (!offerFile) {
    ensureInaturCookie();
  }

  const nodeId = process.env.INATUR_NODE_ID ?? '63ee3bc2d0440d29d6c7ef45';
  const sellerId = process.env.INATUR_SELLER_ID ?? '63ee193639a4b03b97f009e9';
  const cardId = process.env.INATUR_CARD_ID ?? '63ee3ba9d0440d29d6c7ef44';
  let editOfferId = 'offline-offer-file';
  let offer;
  let cookieJar = null;
  let csrfToken = null;

  const stays = parseAirbnbIcal(await readIcal(), {
    includeUnavailable: hasFlag('--include-airbnb-unavailable')
  });
  const scriptPeriods = stays.map(buildScriptPeriod);
  if (offerFile) {
    offer = await readOfferFromFile();
  } else {
    const editable = await withRefreshedCookieOnLogin(async () => {
      cookieJar = readCookieJar();
      return fetchEditableOffer({ sellerId, nodeId, cookieJar });
    });
    editOfferId = editable.editOfferId;
    offer = editable.offer;
    csrfToken = editable.csrfToken;
  }
  const beforeCard = getTargetCard(offer, cardId);
  const updatedOffer = updateOfferPeriods(offer, cardId, scriptPeriods);
  const afterCard = getTargetCard(updatedOffer, cardId);
  const diff = createSyncDiff({
    existingPeriods: beforeCard.antall.perioder ?? [],
    desiredPeriods: scriptPeriods
  });

  console.log(formatSyncPlan(diff, { publish: shouldPublish }));
  console.log(JSON.stringify({
    publish: shouldPublish,
    stays: stays.length,
    add: diff.add.length,
    remove: diff.remove.length,
    keep: diff.keep.length,
    coveredByManual: diff.coveredByManual.length,
    beforeScriptOwned: (beforeCard.antall.perioder ?? []).filter((period) => period.kommentar?.includes('[airbnb-inatur-sync]')).length,
    afterScriptOwned: (afterCard.antall.perioder ?? []).filter((period) => period.kommentar?.includes('[airbnb-inatur-sync]')).length
  }, null, 2));

  if (!shouldPublish) return;

  if (!hasChanges(diff)) {
    console.log('No changes');
    return;
  }

  const cookieHeader = cookieJarToHeader(cookieJar);
  await saveOffer(editOfferId, updatedOffer, { cookieHeader, csrfToken });
  await writeChangelog('kort', buildKortChangelog(nodeId, beforeCard, afterCard), { cookieHeader, csrfToken });

  const publishOffer = {
    ...updatedOffer,
    skalPublisere: true
  };
  await saveOffer(editOfferId, publishOffer, { cookieHeader, csrfToken });
  await writeChangelog(
    'skalPublisere',
    buildPublishChangelog(nodeId, 'Oppdatert av airbnb-inatur-sync [codex-sync]'),
    { cookieHeader, csrfToken }
  );

  if (process.env.INATUR_AVAILABILITY_ICAL_URL) {
    const ical = await fetchText(process.env.INATUR_AVAILABILITY_ICAL_URL);
    console.log(`Fetched Inatur availability iCal (${ical.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
