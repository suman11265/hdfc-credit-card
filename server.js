// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// proxy के पीछे सही IP वगैरह के लिए
app.set('trust proxy', 1);

// ------- Config: अपनी APK का path/नाम यहाँ रखें -------
const APK_DIR = path.join(__dirname, 'apk');
const APK_FILE = 'signed.apk';
const APK_PATH = path.join(APK_DIR, APK_FILE);
// -----------------------------------------------------

// Health check (Render 502 से बचे)
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// एक helper: APK भेजना (full + range + headers)
function sendApk(req, res) {
  fs.stat(APK_PATH, (err, stat) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).send('File not found');
      console.error('stat error:', err);
      return res.status(500).send('Server error');
    }

    const etag = crypto
      .createHash('sha1')
      .update(`${stat.size}-${stat.mtimeMs}`)
      .digest('hex');

    // सही headers
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    res.setHeader('ETag', etag);
    res.setHeader('Accept-Ranges', 'bytes');

    // Cache (optional): CDN/Browser caching
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Not Modified?
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d+)?/.exec(range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          res.setHeader('Content-Range', `bytes */${stat.size}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', end - start + 1);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${APK_FILE}"`
        );
        return fs.createReadStream(APK_PATH, { start, end })
          .on('error', (e) => {
            console.error('stream error (range):', e);
            if (!res.headersSent) res.status(500).end('Read error');
          })
          .pipe(res);
      }
    }

    // Full file
    res.setHeader('Content-Length', stat.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${APK_FILE}"`
    );
    fs.createReadStream(APK_PATH)
      .on('error', (e) => {
        console.error('stream error (full):', e);
        if (!res.headersSent) res.status(500).end('Read error');
      })
      .pipe(res);
  });
}

// Root पर भी direct download
app.get('/', (req, res) => sendApk(req, res));

// /download पर भी same
app.get('/download', (req, res) => sendApk(req, res));

// Server timeouts: 499 कम करने में मदद
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server up on :${PORT}  →  /  &  /download`);
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 67000;

process.on('unhandledRejection', (e) => {
  console.error('unhandledRejection', e);
  process.exit(1);
});
process.on('uncaughtException', (e) => {
  console.error('uncaughtException', e);
  process.exit(1);
});
