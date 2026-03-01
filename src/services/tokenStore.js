const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const logger = require('./logger');

const log = logger.create ? logger.create('tokenStore') : logger;

const TOKEN_FILE = 'mobile-token.json';

class TokenStore {
  constructor() {
    this._token = null;
    this._filePath = null;
  }

  /**
   * Initialise the store: load existing token or generate a new one.
   * Must be called after app.whenReady().
   */
  init() {
    const dir = app.getPath('userData');
    this._filePath = path.join(dir, TOKEN_FILE);

    try {
      if (fs.existsSync(this._filePath)) {
        const data = JSON.parse(fs.readFileSync(this._filePath, 'utf-8'));
        if (data.token && typeof data.token === 'string' && data.token.length === 64) {
          this._token = data.token;
          log.info('Loaded existing mobile token');
          return;
        }
      }
    } catch (err) {
      log.warn('Failed to read token file, generating new token', { message: err.message });
    }

    this._token = crypto.randomBytes(32).toString('hex');
    this._persist();
    log.info('Generated new mobile token');
  }

  /** Returns the current bearer token. */
  getToken() {
    return this._token;
  }

  /** Validates a candidate token against the stored one. */
  validate(candidate) {
    if (!this._token || !candidate) return false;
    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(this._token, 'utf-8'),
        Buffer.from(candidate, 'utf-8'),
      );
    } catch {
      return false;
    }
  }

  /** Regenerates the token and persists to disk. */
  regenerate() {
    this._token = crypto.randomBytes(32).toString('hex');
    this._persist();
    log.info('Regenerated mobile token');
    return this._token;
  }

  _persist() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this._filePath, JSON.stringify({ token: this._token }), 'utf-8');
    } catch (err) {
      log.error('Failed to persist token', { message: err.message });
    }
  }
}

module.exports = TokenStore;
