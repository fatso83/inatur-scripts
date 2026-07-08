const MARKER = '[airbnb-inatur-sync]';

function getTimeZoneOffsetMs(timeZone, utcMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(utcMs));

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );

  return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - utcMs;
}

function dateToOsloMidnightMs(date) {
  const [year, month, day] = date.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  return utcMidnight - getTimeZoneOffsetMs('Europe/Oslo', utcMidnight);
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatNoDate(date) {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${Number(month)}.${year}`;
}

function buildScriptPeriod(stay) {
  const tilDate = addDays(stay.endDateExclusive, -1);
  return {
    fra: dateToOsloMidnightMs(stay.startDate),
    til: dateToOsloMidnightMs(tilDate),
    verdi: 0,
    kommentar: `${MARKER} uid=${stay.uid}`,
    fraFormatert: formatNoDate(stay.startDate),
    tilFormatert: formatNoDate(tilDate)
  };
}

function isScriptOwnedPeriod(period) {
  return typeof period.kommentar === 'string' && period.kommentar.includes(MARKER);
}

function periodsOverlap(left, right) {
  return left.fra <= right.til && right.fra <= left.til;
}

function isManualBlockingPeriod(period) {
  return !isScriptOwnedPeriod(period) && period.verdi === 0;
}

function isCoveredByManualBlockingPeriod(period, existingPeriods) {
  return existingPeriods.some((existing) => isManualBlockingPeriod(existing) && periodsOverlap(period, existing));
}

function replaceScriptOwnedPeriods(existingPeriods, nextScriptPeriods) {
  const nextNonOverlappingScriptPeriods = nextScriptPeriods.filter(
    (period) => !isCoveredByManualBlockingPeriod(period, existingPeriods)
  );
  return [
    ...existingPeriods.filter((period) => !isScriptOwnedPeriod(period)),
    ...nextNonOverlappingScriptPeriods
  ].sort((a, b) => a.fra - b.fra || a.til - b.til);
}

function getTargetCard(offer, cardId) {
  const card = offer.kort?.find((entry) => entry.id === cardId);
  if (!card) throw new Error(`Could not find Inatur card ${cardId}`);
  return card;
}

function updateOfferPeriods(offer, cardId, scriptPeriods) {
  const updatedOffer = structuredClone(offer);
  const card = getTargetCard(updatedOffer, cardId);
  const existing = card.antall?.perioder ?? [];
  card.antall = {
    ...card.antall,
    perioder: replaceScriptOwnedPeriods(existing, scriptPeriods),
    harPerioder: true
  };
  return updatedOffer;
}

function buildKortChangelog(nodeId, beforeCard, afterCard) {
  return {
    type: 'TILBUD',
    attribute: 'kort',
    method: 'KORT_CHANGED',
    from: { value: { numKort: 1, kortdetaljer: beforeCard } },
    to: { value: { numKort: 1, kortdetaljer: afterCard } },
    nodeId
  };
}

function buildPublishChangelog(nodeId, comment) {
  return {
    type: 'TILBUD',
    attribute: 'skalPublisere',
    method: 'CREATED',
    from: {},
    to: { value: { comment: `${comment}\n` } },
    nodeId
  };
}

module.exports = {
  MARKER,
  buildScriptPeriod,
  buildKortChangelog,
  buildPublishChangelog,
  getTargetCard,
  isCoveredByManualBlockingPeriod,
  replaceScriptOwnedPeriods,
  updateOfferPeriods
};
