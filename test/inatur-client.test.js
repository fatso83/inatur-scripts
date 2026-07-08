const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractCsrfTokenFromHtml,
  extractTilbudJsonFromHtml,
  fetchEditableOffer,
  resolveEditDraftId,
  saveOffer
} = require('../lib/inatur-client');

test('resolves current edit draft id from editDraft response script', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://web2.inatur.no/min-side/selger/seller-1/salgssider.data');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.toString(), 'intent=editDraft&salesPageId=node-1');

    return new Response('window.location="/min-side/tilbud/rediger/6a4d05dd8c2f9d217c8c7b54#rediger/no"', {
      status: 202
    });
  });

  assert.equal(
    await resolveEditDraftId({ sellerId: 'seller-1', nodeId: 'node-1' }),
    '6a4d05dd8c2f9d217c8c7b54'
  );
});

test('reports login redirects while resolving edit draft id', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('[{"_1":2},"redirect","/login?callbackAction=/min-side"]', {
    status: 202
  }));

  await assert.rejects(
    () => resolveEditDraftId({ sellerId: 'seller-1', nodeId: 'node-1' }),
    /Inatur session redirected to login/
  );
});

test('extracts tilbudJson object from edit page HTML', () => {
  const html = `
    <html>
      <script>
        tilbudJson = JSON.parse(JSON.stringify({"id":"offer-1","tekst":"brace } in string","kort":[{"id":"card-1"}]}));
      </script>
    </html>
  `;

  assert.deepEqual(extractTilbudJsonFromHtml(html), {
    id: 'offer-1',
    tekst: 'brace } in string',
    kort: [{ id: 'card-1' }]
  });
});

test('extracts CSRF token from edit page HTML', () => {
  assert.equal(
    extractCsrfTokenFromHtml('<meta name="_csrf_parameter" content="_csrf" /><meta name="_csrf" content="csrf-1" />'),
    'csrf-1'
  );
});

test('fetches editable offer by activating seller role and reading edit page HTML', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://web2.inatur.no/min-side/selger/seller-1/salgssider.data') {
      assert.match(options.headers.Cookie, /KEYCLOAK_IDENTITY=identity-1/);
      return new Response('[{"_1":2},"redirect","https://www.inatur.no/web2/role/selger/seller-1?redirectTo=/min-side/tilbud/rediger/utkast/node-1#rediger/no"]', {
        status: 202
      });
    }
    if (url === 'https://www.inatur.no/web2/role/selger/seller-1?redirectTo=/min-side/tilbud/rediger/utkast/node-1#rediger/no') {
      assert.equal(options.redirect, 'manual');
      return new Response('', {
        status: 302,
        headers: { 'set-cookie': 'aktivTilbyder=seller-1; Path=/' }
      });
    }
    if (url === 'https://www.inatur.no/min-side/tilbud/rediger/utkast/node-1?spraak=no') {
      assert.match(options.headers.Cookie, /aktivTilbyder=seller-1/);
      return new Response('<meta name="_csrf" content="csrf-1" /><script>tilbudJson = JSON.parse(JSON.stringify({"id":"offer-1","kort":[]}));</script>', {
        status: 200
      });
    }
    throw new Error(`unexpected URL ${url}`);
  });

  const cookieJar = [
    { name: 'KEYCLOAK_IDENTITY', value: 'identity-1' },
    { name: 'aktivTilbyder', value: 'old-seller' }
  ];
  assert.deepEqual(
    await fetchEditableOffer({ sellerId: 'seller-1', nodeId: 'node-1', cookieJar }),
    { editOfferId: 'offer-1', offer: { id: 'offer-1', kort: [] }, csrfToken: 'csrf-1' }
  );
  assert.equal(calls.length, 3);
  assert.equal(cookieJar.find((cookie) => cookie.name === 'aktivTilbyder').value, 'seller-1');
});

test('reports login redirects while fetching editable offer', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('[{"_1":2},"redirect","/login?callbackAction=/min-side"]', {
    status: 202
  }));

  await assert.rejects(
    () => fetchEditableOffer({ sellerId: 'seller-1', nodeId: 'node-1', cookieJar: [] }),
    /Inatur session redirected to login/
  );
});

test('saveOffer sends JSON with CSRF and x-requested-with headers', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://www.inatur.no/min-side/tilbud/rediger/edit-1?spraak=no');
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers['x-requested-with'], 'XMLHttpRequest');
    assert.equal(options.headers['x-csrf-token'], 'csrf-1');
    assert.equal(options.body, '{"id":"offer-1"}');

    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });

  assert.deepEqual(await saveOffer('edit-1', { id: 'offer-1' }, { csrfToken: 'csrf-1' }), { ok: true });
});
