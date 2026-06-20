'use strict';

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    const paramNames = [];
    const pattern =
      '^' +
      path
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            paramNames.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '$';
    this.routes.push({ method, regex: new RegExp(pattern), paramNames, handler });
  }

  get(path, handler) {
    this.add('GET', path, handler);
  }

  post(path, handler) {
    this.add('POST', path, handler);
  }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

module.exports = Router;
