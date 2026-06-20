'use strict';
const { redirect } = require('./render');

function requireUser(req, res) {
  if (!req.user) {
    redirect(res, '/login', 'سجّل دخولك أول.', 'error');
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (!req.user || !req.user.is_admin) {
    redirect(res, '/login', 'هذا الجزء خاص بالأدمن فقط.', 'error');
    return false;
  }
  return true;
}

module.exports = { requireUser, requireAdmin };
