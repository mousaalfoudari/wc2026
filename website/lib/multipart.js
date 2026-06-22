'use strict';

// Minimal hand-rolled multipart/form-data parser. No external dependencies
// (project is zero-dependency by design), so this isn't a general-purpose
// replacement for a real multipart library — it's just enough to support our
// one use case so far: an admin uploading a single lineup image per match
// (see routes/admin.js, POST /admin/matches/:id/lineup).
//
// Known accepted limitation: this splits on raw occurrences of the boundary
// bytes without a full streaming state machine, so if a file's binary content
// happened to contain the exact boundary string, parsing would break. Browser
// boundary tokens are long random strings, so the odds of that happening by
// chance are astronomically small, and this route is admin-only — not worth
// the extra complexity for this app.

function parseContentType(header) {
  const parts = String(header || '')
    .split(';')
    .map((p) => p.trim());
  const type = (parts[0] || '').toLowerCase();
  let boundary = null;
  for (const p of parts.slice(1)) {
    const m = /^boundary=(.+)$/i.exec(p);
    if (m) {
      boundary = m[1];
      if (boundary.startsWith('"') && boundary.endsWith('"')) {
        boundary = boundary.slice(1, -1);
      }
    }
  }
  return { type, boundary };
}

// buffer: raw request body as a Buffer. boundary: the boundary token from
// the Content-Type header (without the leading "--").
// Returns { fields: {name: string}, files: {name: {filename, contentType, data: Buffer}} }
function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = {};
  if (!boundary || !buffer || !buffer.length) return { fields, files };

  const boundaryBuf = Buffer.from(`--${boundary}`);
  const partBuffers = [];
  let pos = buffer.indexOf(boundaryBuf);
  while (pos !== -1) {
    const next = buffer.indexOf(boundaryBuf, pos + boundaryBuf.length);
    if (next === -1) break;
    partBuffers.push(buffer.slice(pos + boundaryBuf.length, next));
    pos = next;
  }

  for (let part of partBuffers) {
    if (part.slice(0, 2).toString('latin1') === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString('latin1') === '\r\n') part = part.slice(0, -2);
    if (!part.length) continue;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const rawHeaders = part.slice(0, headerEnd).toString('utf8');
    const body = part.slice(headerEnd + 4);

    const dispositionMatch = /Content-Disposition:\s*form-data;\s*([^\r\n]+)/i.exec(rawHeaders);
    if (!dispositionMatch) continue;
    const disposition = dispositionMatch[1];
    const nameMatch = /name="([^"]*)"/i.exec(disposition);
    const filenameMatch = /filename="([^"]*)"/i.exec(disposition);
    const name = nameMatch ? nameMatch[1] : null;
    if (!name) continue;

    if (filenameMatch) {
      if (!filenameMatch[1]) continue; // file input present but no file chosen
      const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(rawHeaders);
      files[name] = {
        filename: filenameMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
        data: body,
      };
    } else {
      fields[name] = body.toString('utf8');
    }
  }

  return { fields, files };
}

module.exports = { parseContentType, parseMultipart };
