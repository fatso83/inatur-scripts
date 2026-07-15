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

async function materializeStateFiles({ tokenPath, cookiePath, state }) {
  await Promise.all([
    fs.mkdir(path.dirname(tokenPath), { recursive: true }),
    fs.mkdir(path.dirname(cookiePath), { recursive: true })
  ]);

  if (state.sessionToken) {
    await fs.writeFile(tokenPath, `${state.sessionToken}\n`);
  } else {
    await fs.rm(tokenPath, { force: true });
  }

  await fs.writeFile(cookiePath, JSON.stringify(state.cookies ?? [], null, 2));
}

async function captureStateFiles({ tokenPath, cookiePath }) {
  const [sessionTokenText, cookieText] = await Promise.all([
    readTextIfExists(tokenPath),
    readTextIfExists(cookiePath)
  ]);

  return {
    sessionToken: sessionTokenText?.trim() || null,
    cookies: cookieText ? JSON.parse(cookieText) : []
  };
}

module.exports = { captureStateFiles, materializeStateFiles };
