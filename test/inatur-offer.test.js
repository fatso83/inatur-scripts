const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildScriptPeriod,
  replaceScriptOwnedPeriods
} = require('../lib/inatur-offer');

test('builds Inatur zero-capacity periods with script marker', () => {
  assert.deepEqual(
    buildScriptPeriod({
      startDate: '2026-10-20',
      endDateExclusive: '2026-10-22',
      uid: 'abc'
    }),
    {
      fra: 1792447200000,
      til: 1792533600000,
      verdi: 0,
      kommentar: '[airbnb-inatur-sync] uid=abc',
      fraFormatert: '20.10.2026',
      tilFormatert: '21.10.2026'
    }
  );
});

test('uses Europe/Oslo midnight for winter dates', () => {
  assert.equal(
    buildScriptPeriod({
      startDate: '2026-01-20',
      endDateExclusive: '2026-01-21',
      uid: 'winter'
    }).fra,
    1768863600000
  );
});

test('replaces only script-owned periods and preserves manual periods', () => {
  const manual = { fra: 1, til: 2, verdi: 0, kommentar: 'familie' };
  const oldScript = { fra: 3, til: 4, verdi: 0, kommentar: '[airbnb-inatur-sync] uid=old' };
  const nextScript = { fra: 5, til: 6, verdi: 0, kommentar: '[airbnb-inatur-sync] uid=new' };

  assert.deepEqual(replaceScriptOwnedPeriods([manual, oldScript], [nextScript]), [manual, nextScript]);
});

test('does not add script periods already covered by manual zero-capacity periods', () => {
  const manual = { fra: 10, til: 20, verdi: 0, kommentar: 'airbnb: Marit' };
  const overlappingScript = { fra: 12, til: 13, verdi: 0, kommentar: '[airbnb-inatur-sync] uid=booking' };

  assert.deepEqual(replaceScriptOwnedPeriods([manual], [overlappingScript]), [manual]);
});
