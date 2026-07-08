const assert = require('node:assert/strict');
const test = require('node:test');

const { createSyncDiff, formatSyncPlan } = require('../lib/sync-diff');

test('reports add, remove, and keep actions for script-owned blocks', () => {
  const desiredPeriods = [
    {
      fra: 1792447200000,
      til: 1792533600000,
      kommentar: '[airbnb-inatur-sync] uid=keep',
      fraFormatert: '20.10.2026',
      tilFormatert: '21.10.2026',
      verdi: 0
    },
    {
      fra: 1792620000000,
      til: 1792706400000,
      kommentar: '[airbnb-inatur-sync] uid=add',
      fraFormatert: '22.10.2026',
      tilFormatert: '23.10.2026',
      verdi: 0
    }
  ];

  const existingPeriods = [
    {
      fra: 1792447200000,
      til: 1792533600000,
      kommentar: '[airbnb-inatur-sync] uid=keep',
      fraFormatert: '20.10.2026',
      tilFormatert: '21.10.2026',
      verdi: 0
    },
    {
      fra: 1792792800000,
      til: 1792879200000,
      kommentar: '[airbnb-inatur-sync] uid=remove',
      fraFormatert: '24.10.2026',
      tilFormatert: '25.10.2026',
      verdi: 0
    },
    {
      fra: 1792965600000,
      til: 1793052000000,
      kommentar: 'familie',
      fraFormatert: '26.10.2026',
      tilFormatert: '27.10.2026',
      verdi: 0
    }
  ];

  assert.deepEqual(createSyncDiff({ existingPeriods, desiredPeriods }), {
    add: [desiredPeriods[1]],
    remove: [existingPeriods[1]],
    keep: [desiredPeriods[0]],
    coveredByManual: []
  });
});

test('reports desired periods covered by manual blocks without adding overlapping script blocks', () => {
  const desired = {
    fra: 12,
    til: 13,
    kommentar: '[airbnb-inatur-sync] uid=booking',
    fraFormatert: '11.9.2026',
    tilFormatert: '12.9.2026',
    verdi: 0
  };
  const manual = {
    fra: 10,
    til: 20,
    kommentar: 'airbnb: Marit',
    fraFormatert: '11.09.2026',
    tilFormatert: '13.09.2026',
    verdi: 0
  };

  assert.deepEqual(createSyncDiff({ existingPeriods: [manual], desiredPeriods: [desired] }), {
    add: [],
    remove: [],
    keep: [],
    coveredByManual: [desired]
  });
});

test('treats HTML-escaped Inatur comments as the same script-owned UID', () => {
  const desired = {
    fra: 1799445600000,
    til: 1799532000000,
    kommentar: '[airbnb-inatur-sync] uid=1418fb94e984-39fdb4c57277ad6181b7b5855ced4239@airbnb.com',
    fraFormatert: '11.9.2026',
    tilFormatert: '12.9.2026',
    verdi: 0
  };
  const existing = {
    fra: 1799445600000,
    til: 1799532000000,
    kommentar: '[airbnb-inatur-sync] uid&#61;1418fb94e984-39fdb4c57277ad6181b7b5855ced4239&#64;airbnb.com',
    fraFormatert: '11.09.2026',
    tilFormatert: '12.09.2026',
    verdi: 0
  };

  assert.deepEqual(createSyncDiff({ existingPeriods: [existing], desiredPeriods: [desired] }), {
    add: [],
    remove: [],
    keep: [desired],
    coveredByManual: []
  });
});

test('formats preview output as human-readable Norwegian actions', () => {
  const output = formatSyncPlan({
    add: [{ fraFormatert: '22.10.2026', tilFormatert: '23.10.2026', kommentar: '[airbnb-inatur-sync] uid=add' }],
    remove: [{ fraFormatert: '24.10.2026', tilFormatert: '25.10.2026', kommentar: '[airbnb-inatur-sync] uid=remove' }],
    keep: [],
    coveredByManual: []
  });

  assert.match(output, /vil legge til sperring 22\.10\.2026 -> 23\.10\.2026/);
  assert.match(output, /vil slette sperring 24\.10\.2026 -> 25\.10\.2026/);
});
