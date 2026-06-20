'use strict';
const fs = require('fs');
const path = require('path');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendHtml(res, html, status) {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status || 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

function sendText(res, text, status) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status || 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return false;
  const ext = path.extname(full);
  const body = fs.readFileSync(full);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'public, max-age=600',
  });
  res.end(body);
  return true;
}

module.exports = { sendHtml, sendText, serveStatic };
