const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const logger = require('./logger').create('tunnelManager');

/**
 * Manages a Cloudflare Tunnel (cloudflared) child process to expose
 * the mobile server over a public HTTPS URL.
 *
 * Events:
 *   'url'   — (url: string) tunnel URL is ready
 *   'error' — (err: Error)  tunnel process error
 *   'exit'  — (code: number|null) tunnel process exited
 */
class TunnelManager extends EventEmitter {
  constructor() {
    super();
    this._proc = null;
    this._url = null;
    this._running = false;
  }

  /** Returns the current public tunnel URL, or null. */
  getUrl() {
    return this._url;
  }

  /** Returns whether the tunnel is running. */
  isRunning() {
    return this._running;
  }

  /**
   * Start a quick Cloudflare Tunnel pointing to the given local URL.
   * Requires `cloudflared` to be installed and on PATH.
   *
   * @param {number} localPort - The local port to expose (e.g. 7700)
   */
  start(localPort) {
    if (this._running) {
      logger.warn('Tunnel already running');
      return;
    }

    this._url = null;
    this._running = true;

    const localUrl = `http://localhost:${localPort}`;
    logger.info(`Starting cloudflared tunnel for ${localUrl}`);

    try {
      this._proc = spawn('cloudflared', ['tunnel', '--url', localUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      this._running = false;
      logger.error('Failed to spawn cloudflared', { message: err.message });
      this.emit('error', err);
      return;
    }

    // cloudflared prints the public URL to stderr
    let stderrBuf = '';
    this._proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      // Look for the trycloudflare.com URL
      const match = stderrBuf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !this._url) {
        this._url = match[0];
        logger.info(`Tunnel ready: ${this._url}`);
        this.emit('url', this._url);
      }
    });

    this._proc.stdout.on('data', (chunk) => {
      // cloudflared may also print to stdout in some versions
      const text = chunk.toString();
      if (!this._url) {
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match) {
          this._url = match[0];
          logger.info(`Tunnel ready: ${this._url}`);
          this.emit('url', this._url);
        }
      }
    });

    this._proc.on('error', (err) => {
      this._running = false;
      logger.error('Cloudflared process error', { message: err.message });
      this.emit('error', err);
    });

    this._proc.on('exit', (code) => {
      this._running = false;
      this._url = null;
      logger.info(`Cloudflared exited with code ${code}`);
      this.emit('exit', code);
    });
  }

  /**
   * Stop the tunnel process.
   */
  stop() {
    if (!this._proc) return;

    logger.info('Stopping cloudflared tunnel');
    try {
      this._proc.kill('SIGTERM');
    } catch {
      try { this._proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    this._proc = null;
    this._url = null;
    this._running = false;
  }
}

module.exports = TunnelManager;
