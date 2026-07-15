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

async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
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
    await Promise.all([
      ensureParentDirectory(this.tokenPath),
      ensureParentDirectory(this.cookiePath)
    ]);

    if (sessionToken) {
      await fs.writeFile(this.tokenPath, `${sessionToken}\n`);
    } else {
      await fs.rm(this.tokenPath, { force: true });
    }
    await fs.writeFile(this.cookiePath, JSON.stringify(cookies ?? [], null, 2));
  }
}

module.exports = { LocalFileCookieStateStore };
