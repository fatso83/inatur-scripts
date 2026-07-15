const fs = require('node:fs/promises');
const { parseAirbnbIcal } = require('./airbnb-ical');
const {
  buildKortChangelog,
  buildPublishChangelog,
  buildScriptPeriod,
  getTargetCard,
  updateOfferPeriods
} = require('./inatur-offer');
const { createSyncDiff, formatSyncPlan } = require('./sync-diff');
const {
  cookieJarToHeader,
  DEFAULT_AIRBNB_ICAL_URL,
  ensureInaturCookie,
  readCookieJar: defaultReadCookieJar,
  refreshInaturCookie
} = require('./local-runtime');
const {
  fetchEditableOffer,
  fetchText,
  saveOffer: defaultSaveOffer,
  writeChangelog: defaultWriteChangelog
} = require('./inatur-client');

function hasChanges(diff) {
  return diff.add.length > 0 || diff.remove.length > 0;
}

function buildRuntimeEnv({ env, tokenPath, cookiePath }) {
  return {
    ...env,
    ...(tokenPath ? { INATUR_TOKEN_FILE: tokenPath } : {}),
    ...(cookiePath ? { INATUR_COOKIES_FILE: cookiePath } : {})
  };
}

async function withRefreshedCookieOnLogin(fn, { cwd, env, refreshCookie }) {
  try {
    return await fn();
  } catch (error) {
    if (!/Inatur session redirected to login/.test(error.message)) {
      throw error;
    }
    await refreshCookie({ cwd, env });
    return fn();
  }
}

async function runSync({
  publish = false,
  includeAirbnbUnavailable = false,
  offerFile = null,
  cwd = process.cwd(),
  env = process.env,
  tokenPath,
  cookiePath,
  ensureCookie = ensureInaturCookie,
  refreshCookie = refreshInaturCookie,
  readCookieJar = defaultReadCookieJar,
  readIcal,
  readOfferFromFile = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8')),
  readEditableOffer,
  saveOffer = defaultSaveOffer,
  writeChangelog = defaultWriteChangelog,
  fetchAvailabilityIcal = fetchText,
  fetchIcal = fetchText,
  config = {},
  logger = console
} = {}) {
  if (publish && offerFile) {
    throw new Error('Refusing --publish with --offer-file; --offer-file is for offline preview only.');
  }

  const runtimeEnv = buildRuntimeEnv({ env, tokenPath, cookiePath });
  const nodeId = config.nodeId ?? runtimeEnv.INATUR_NODE_ID ?? '63ee3bc2d0440d29d6c7ef45';
  const sellerId = config.sellerId ?? runtimeEnv.INATUR_SELLER_ID ?? '63ee193639a4b03b97f009e9';
  const cardId = config.cardId ?? runtimeEnv.INATUR_CARD_ID ?? '63ee3ba9d0440d29d6c7ef44';
  const availabilityIcalUrl = config.availabilityIcalUrl ?? runtimeEnv.INATUR_AVAILABILITY_ICAL_URL;
  const airbnbIcalUrl = config.airbnbIcalUrl ?? runtimeEnv.AIRBNB_ICAL_URL ?? DEFAULT_AIRBNB_ICAL_URL;
  const defaultReadEditableOffer = async ({ cookieJar }) => fetchEditableOffer({ sellerId, nodeId, cookieJar });
  const liveReadEditableOffer = readEditableOffer ?? defaultReadEditableOffer;
  const liveReadIcal = readIcal ?? (() => fetchIcal(airbnbIcalUrl));

  if (!offerFile) {
    await ensureCookie({ cwd, env: runtimeEnv });
  }

  const stays = parseAirbnbIcal(await liveReadIcal(), { includeUnavailable: includeAirbnbUnavailable });
  const scriptPeriods = stays.map(buildScriptPeriod);
  let editOfferId = 'offline-offer-file';
  let offer;
  let cookieJar = null;
  let csrfToken = null;

  if (offerFile) {
    offer = await readOfferFromFile(offerFile);
  } else {
    const editable = await withRefreshedCookieOnLogin(async () => {
      cookieJar = readCookieJar({ cwd, env: runtimeEnv, cookiePath });
      return liveReadEditableOffer({ sellerId, nodeId, cookieJar, env: runtimeEnv, cwd });
    }, { cwd, env: runtimeEnv, refreshCookie });
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

  const summary = {
    publish,
    stays: stays.length,
    add: diff.add.length,
    remove: diff.remove.length,
    keep: diff.keep.length,
    coveredByManual: diff.coveredByManual.length,
    beforeScriptOwned: (beforeCard.antall.perioder ?? []).filter((period) => period.kommentar?.includes('[airbnb-inatur-sync]')).length,
    afterScriptOwned: (afterCard.antall.perioder ?? []).filter((period) => period.kommentar?.includes('[airbnb-inatur-sync]')).length
  };

  logger.log(formatSyncPlan(diff, { publish }));
  logger.log(JSON.stringify(summary, null, 2));

  if (!publish) return { ...summary, diff };

  if (!hasChanges(diff)) {
    logger.log('No changes');
    return { ...summary, diff };
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

  if (availabilityIcalUrl) {
    const ical = await fetchAvailabilityIcal(availabilityIcalUrl);
    logger.log(`Fetched Inatur availability iCal (${ical.length} bytes)`);
  }

  return { ...summary, diff };
}

module.exports = { runSync };
