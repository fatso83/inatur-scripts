const { applySetCookieHeader, cookieJarToHeader } = require('./local-runtime');

async function requestJson(url, options = {}) {
  const { cookieHeader, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Cookie: cookieHeader ?? process.env.INATUR_COOKIE ?? '',
      ...fetchOptions.headers
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function requestText(url, options = {}) {
  const { cookieHeader, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Accept: '*/*',
      Cookie: cookieHeader ?? process.env.INATUR_COOKIE ?? '',
      ...fetchOptions.headers
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return text;
}

async function requestTextResponse(url, options = {}) {
  const { cookieHeader, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      Accept: '*/*',
      Cookie: cookieHeader ?? process.env.INATUR_COOKIE ?? '',
      ...fetchOptions.headers
    }
  });

  const text = await response.text();
  if (response.status >= 400) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 500)}`);
  }
  return { response, text };
}

function requireCsrfToken(csrfToken) {
  const token = csrfToken ?? process.env.INATUR_CSRF_TOKEN;
  if (!token) {
    throw new Error('Could not find CSRF token from edit page HTML or INATUR_CSRF_TOKEN.');
  }
  return token;
}

function extractRedirectUrl(responseText) {
  const urlMatch = /https:\/\/www\.inatur\.no\/web2\/role\/selger\/[^"\\]+/.exec(responseText);
  if (urlMatch) return urlMatch[0].replace(/\\u0026/g, '&');

  const pathMatch = /\/min-side\/tilbud\/rediger\/(?:utkast\/)?[^"\\#]+(?:#[^"\\]+)?/.exec(responseText);
  if (pathMatch) return new URL(pathMatch[0], 'https://www.inatur.no').toString();

  return null;
}

function extractEditOfferId(responseText) {
  const directMatch = /rediger\/([a-f0-9]{24})/.exec(responseText);
  if (directMatch) return directMatch[1];
  return null;
}

function extractTilbudJsonFromHtml(html) {
  const marker = 'tilbudJson = JSON.parse(JSON.stringify(';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Could not find tilbudJson in edit page HTML');
  }

  const start = html.indexOf('{', markerIndex + marker.length);
  if (start === -1) {
    throw new Error('Could not find tilbudJson object start in edit page HTML');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(html.slice(start, index + 1));
      }
    }
  }

  throw new Error('Could not find tilbudJson object end in edit page HTML');
}

function extractCsrfTokenFromHtml(html) {
  const match = /<meta\s+name=["']_csrf["']\s+content=["']([^"']+)["']\s*\/?>/i.exec(html) ||
    /<meta\s+content=["']([^"']+)["']\s+name=["']_csrf["']\s*\/?>/i.exec(html);
  if (!match) {
    throw new Error('Could not find CSRF token in edit page HTML');
  }
  return match[1];
}

async function resolveEditDraftId({ sellerId, nodeId, cookieHeader }) {
  const body = new URLSearchParams({
    intent: 'editDraft',
    salesPageId: nodeId
  });
  const responseText = await requestText(`https://web2.inatur.no/min-side/selger/${sellerId}/salgssider.data`, {
    method: 'POST',
    cookieHeader,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body
  });

  if (responseText.includes('/login?') || responseText.includes('"/login')) {
    throw new Error('Inatur session redirected to login');
  }

  const match = /rediger\/([a-f0-9]{24})/.exec(responseText);
  if (!match) {
    throw new Error('Could not find current edit draft id in editDraft response');
  }
  return match[1];
}

async function fetchEditableOffer({ sellerId, nodeId, cookieJar }) {
  const body = new URLSearchParams({
    intent: 'editDraft',
    salesPageId: nodeId
  });
  const responseText = await requestText(`https://web2.inatur.no/min-side/selger/${sellerId}/salgssider.data`, {
    method: 'POST',
    cookieHeader: cookieJarToHeader(cookieJar),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body
  });

  if (responseText.includes('/login?') || responseText.includes('"/login')) {
    throw new Error('Inatur session redirected to login');
  }

  const directEditOfferId = extractEditOfferId(responseText);
  if (directEditOfferId) {
    return { editOfferId: directEditOfferId, offer: await fetchOffer(directEditOfferId, { cookieHeader: cookieJarToHeader(cookieJar) }) };
  }

  const redirectUrl = extractRedirectUrl(responseText);
  if (redirectUrl?.includes('/web2/role/selger/')) {
    const { response } = await requestTextResponse(redirectUrl, {
      redirect: 'manual',
      cookieHeader: cookieJarToHeader(cookieJar)
    });
    applySetCookieHeader(cookieJar, response.headers.get('set-cookie'));
  } else if (!redirectUrl) {
    throw new Error('Could not find edit draft redirect in editDraft response');
  }

  const editPageUrl = `https://www.inatur.no/min-side/tilbud/rediger/utkast/${nodeId}?spraak=no`;
  const html = await requestText(editPageUrl, {
    cookieHeader: cookieJarToHeader(cookieJar),
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  const offer = extractTilbudJsonFromHtml(html);
  if (!offer.id) {
    throw new Error('Could not find edit offer id in tilbudJson');
  }
  return { editOfferId: offer.id, offer, csrfToken: extractCsrfTokenFromHtml(html) };
}

async function fetchOffer(editOfferId, { cookieHeader } = {}) {
  return requestJson(`https://www.inatur.no/min-side/tilbud/rediger/${editOfferId}?spraak=no`, {
    cookieHeader,
    headers: { 'x-requested-with': 'XMLHttpRequest' }
  });
}

async function saveOffer(editOfferId, offer, { cookieHeader, csrfToken } = {}) {
  return requestJson(`https://www.inatur.no/min-side/tilbud/rediger/${editOfferId}?spraak=no`, {
    method: 'PUT',
    cookieHeader,
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-csrf-token': requireCsrfToken(csrfToken)
    },
    body: JSON.stringify(offer)
  });
}

async function writeChangelog(attribute, payload, { cookieHeader, csrfToken } = {}) {
  return requestJson(`https://www.inatur.no/min-side/tilbud/rediger/api/v1/changelog?attribute=${encodeURIComponent(attribute)}`, {
    method: 'POST',
    cookieHeader,
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': requireCsrfToken(csrfToken)
    },
    body: JSON.stringify(payload)
  });
}

async function fetchText(url) {
  return requestText(url, {
    headers: {
      Accept: 'text/calendar, text/plain, */*'
    }
  });
}

module.exports = {
  extractCsrfTokenFromHtml,
  extractTilbudJsonFromHtml,
  fetchEditableOffer,
  fetchOffer,
  fetchText,
  resolveEditDraftId,
  saveOffer,
  writeChangelog
};
