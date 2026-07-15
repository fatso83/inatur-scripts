const { MARKER, isCoveredByManualBlockingPeriod } = require('./inatur-offer');

function decodeHtmlEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function periodKey(period) {
  const comment = typeof period.kommentar === 'string' ? decodeHtmlEntities(period.kommentar) : '';
  const uidMatch = /uid=([^ ]+)/.exec(comment);
  return uidMatch ? `uid:${uidMatch[1]}` : `dates:${period.fra}:${period.til}`;
}

function isScriptOwned(period) {
  return typeof period.kommentar === 'string' && period.kommentar.includes(MARKER);
}

function createSyncDiff({ existingPeriods, desiredPeriods }) {
  const existingScriptPeriods = existingPeriods.filter(isScriptOwned);
  const coveredByManual = desiredPeriods.filter((period) => isCoveredByManualBlockingPeriod(period, existingPeriods));
  const desiredScriptPeriods = desiredPeriods.filter((period) => !isCoveredByManualBlockingPeriod(period, existingPeriods));
  const existingByKey = new Map(existingScriptPeriods.map((period) => [periodKey(period), period]));
  const desiredByKey = new Map(desiredScriptPeriods.map((period) => [periodKey(period), period]));

  return {
    add: desiredScriptPeriods.filter((period) => !existingByKey.has(periodKey(period))),
    remove: existingScriptPeriods.filter((period) => !desiredByKey.has(periodKey(period))),
    keep: desiredScriptPeriods.filter((period) => existingByKey.has(periodKey(period))),
    coveredByManual
  };
}

function describePeriod(period) {
  const comment = typeof period.kommentar === 'string' ? decodeHtmlEntities(period.kommentar) : period.kommentar;
  return `${period.fraFormatert} -> ${period.tilFormatert} (${comment})`;
}

function formatSyncPlan(diff, { publish = false } = {}) {
  const lines = [publish ? 'Publiserer disse endringene:' : 'Forhandsvisning: ingen endringer blir lagret eller publisert.'];

  for (const period of diff.remove) {
    lines.push(`vil slette sperring ${describePeriod(period)}`);
  }
  for (const period of diff.add) {
    lines.push(`vil legge til sperring ${describePeriod(period)}`);
  }
  for (const period of diff.keep) {
    lines.push(`beholder sperring ${describePeriod(period)}`);
  }
  for (const period of diff.coveredByManual ?? []) {
    lines.push(`hopper over sperring som allerede er manuelt sperret ${describePeriod(period)}`);
  }
  if (diff.add.length === 0 && diff.remove.length === 0) {
    lines.push('ingen endringer');
  }

  return lines.join('\n');
}

module.exports = { createSyncDiff, formatSyncPlan };
