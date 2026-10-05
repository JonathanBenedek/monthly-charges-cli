const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { URL } = require('url');
const { exec } = require('child_process');
const { OAuth2Client } = require('google-auth-library');

const CONFIG_DIR = process.env.MONTHLY_CHARGES_CONFIG_DIR
  || path.join(os.homedir(), '.monthly-charges', 'credentials');
const CLIENT_SECRET_PATH = path.join(CONFIG_DIR, 'client_secret.json');
const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json');

const SCOPES = ['https://www.googleapis.com/auth/drive'];

function loadClientSecret() {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(
      'Missing Google OAuth client secret.\n' +
      'In Google Cloud Console (same project as the web app), create an OAuth client ID of type ' +
      '"Desktop app", download its JSON, and save it to:\n' +
      `  ${CLIENT_SECRET_PATH}\n` +
      'Then run: node bin/cli.js auth'
    );
  }
  const raw = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
  const creds = raw.installed || raw.web || raw;
  if (!creds.client_id || !creds.client_secret) {
    throw new Error(`client_secret.json at ${CLIENT_SECRET_PATH} is missing client_id/client_secret.`);
  }
  return creds;
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')); }
  catch { return null; }
}

function saveToken(tokens) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

/**
 * One-time interactive consent flow (loopback redirect, "installed app" OAuth).
 * Opens the system browser, listens on an ephemeral local port for the redirect,
 * exchanges the auth code for tokens, and caches them to TOKEN_PATH.
 */
async function runConsentFlow() {
  const { client_id, client_secret } = loadClientSecret();

  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;

  const client = new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri });
  const authUrl = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

  const codePromise = new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      let code = null, error = null;
      try {
        const url = new URL(req.url, redirectUri);
        code = url.searchParams.get('code');
        error = url.searchParams.get('error');
      } catch (e) { error = e.message; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(error
        ? `<h2>Authorization failed: ${error}</h2><p>You can close this tab.</p>`
        : `<h2>Authorization complete.</h2><p>You can close this tab and return to the terminal.</p>`);
      if (error) reject(new Error(error));
      else if (code) resolve(code);
    });
    server.on('error', reject);
  });

  process.stderr.write('Open this URL in your browser to authorize Drive access:\n\n' + authUrl + '\n\n');
  exec(`open "${authUrl}"`, () => {}); // best-effort auto-open on macOS; ignore failures

  const code = await codePromise;
  await new Promise(resolve => server.close(resolve));

  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
  saveToken(tokens);
  return tokens;
}

/**
 * Returns an OAuth2Client loaded with the cached refresh token, auto-persisting
 * any refreshed access tokens back to disk. Throws NOT_AUTHENTICATED if `auth`
 * hasn't been run yet.
 */
async function getAuthorizedClient() {
  const { client_id, client_secret } = loadClientSecret();
  const tokens = loadToken();
  if (!tokens) {
    throw Object.assign(new Error('Not authenticated. Run: node bin/cli.js auth'), { code: 'NOT_AUTHENTICATED' });
  }
  const client = new OAuth2Client({ clientId: client_id, clientSecret: client_secret });
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    saveToken({ ...tokens, ...newTokens });
  });
  return client;
}

module.exports = { getAuthorizedClient, runConsentFlow, CONFIG_DIR, CLIENT_SECRET_PATH, TOKEN_PATH };
