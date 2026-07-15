const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_AIRBNB_ICAL_URL = 'https://www.airbnb.no/calendar/ical/18731440.ics?s=dff56d4150cc69b4dca45191401cefbd';

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadDotEnv({ cwd = process.cwd(), env = process.env } = {}) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;

    const [, key, value] = match;
    if (env[key] === undefined || env[key] === '') {
      env[key] = unquote(value);
    }
  }
}

function parseCookieExport(output) {
  const match = /INATUR_COOKIE='([^']+)'/.exec(output);
  if (!match) {
    throw new Error('Could not parse INATUR_COOKIE from cookie-store export');
  }
  return match[1];
}

function runCookieStore(cookieStore, args, { cwd, env, label }) {
  try {
    return childProcess.execFileSync(cookieStore, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    const details = [stderr, stdout].filter(Boolean).join('\n');
    throw new Error(`cookie-store ${label} failed${details ? `:\n${details}` : ''}`);
  }
}

function exportInaturCookie(cookieStore, { cwd, env }) {
  const output = runCookieStore(cookieStore, ['export'], { cwd, env, label: 'export' });
  env.INATUR_COOKIE = parseCookieExport(output);
  return env.INATUR_COOKIE;
}

function getCookiePath({ cwd = process.cwd(), env = process.env, cookiePath } = {}) {
  return cookiePath ?? env.INATUR_COOKIES_FILE ?? path.join(cwd, 'cookies.json');
}

function getTokenPath({ cwd = process.cwd(), env = process.env, tokenPath } = {}) {
  return tokenPath ?? env.INATUR_TOKEN_FILE ?? path.join(cwd, '.session-token.txt');
}

function readCookieJar(options = {}) {
  const cookiePath = getCookiePath(options);
  if (!fs.existsSync(cookiePath)) {
    throw new Error(`${cookiePath} does not exist; run cookie-store refresh first`);
  }

  const jar = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  if (!Array.isArray(jar)) {
    throw new Error('cookies.json must contain a browser cookie array');
  }
  return jar;
}

function cookieJarToHeader(cookieJar) {
  return cookieJar
    .filter((cookie) => cookie?.name && cookie.value !== undefined)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function splitSetCookieHeader(setCookieHeader) {
  if (!setCookieHeader) return [];
  if (Array.isArray(setCookieHeader)) return setCookieHeader;
  return String(setCookieHeader).split(/,(?=\s*[^;,=\s]+=)/).map((cookie) => cookie.trim()).filter(Boolean);
}

function applySetCookieHeader(cookieJar, setCookieHeader) {
  for (const setCookie of splitSetCookieHeader(setCookieHeader)) {
    const [nameValue] = setCookie.split(';');
    const separatorIndex = nameValue.indexOf('=');
    if (separatorIndex === -1) continue;

    const name = nameValue.slice(0, separatorIndex).trim();
    const value = nameValue.slice(separatorIndex + 1).trim();
    if (!name) continue;

    const existing = cookieJar.find((cookie) => cookie.name === name);
    if (existing) {
      existing.value = value;
    } else {
      cookieJar.push({ name, value });
    }
  }
  return cookieJar;
}

function refreshInaturCookie({ cwd = process.cwd(), env = process.env } = {}) {
  const cookieStore = path.join(cwd, 'cookie-store');
  runCookieStore(cookieStore, ['refresh'], { cwd, env, label: 'refresh' });
  return exportInaturCookie(cookieStore, { cwd, env });
}

function ensureInaturCookie({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.INATUR_COOKIE) return env.INATUR_COOKIE;

  const cookieStore = path.join(cwd, 'cookie-store');
  try {
    childProcess.execFileSync(cookieStore, ['validate'], { cwd, env, stdio: 'ignore' });
  } catch {
    runCookieStore(cookieStore, ['refresh'], { cwd, env, label: 'refresh' });
  }

  return exportInaturCookie(cookieStore, { cwd, env });
}

module.exports = {
  applySetCookieHeader,
  cookieJarToHeader,
  DEFAULT_AIRBNB_ICAL_URL,
  ensureInaturCookie,
  getCookiePath,
  getTokenPath,
  loadDotEnv,
  parseCookieExport,
  readCookieJar,
  refreshInaturCookie
};
