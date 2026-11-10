'use strict';
// GitHub Pages stub. Forwards to Cloudflare Pages.
// localStorage and the Garmin return code travel in the URL fragment only.
// NEXT must stay in sync with the origins allowed by run-app-api.
// If the project name run-together is taken, set this to https://run-together-app.pages.dev.
var NEXT = 'https://run-together.pages.dev';
var ALLOW = [
  'ra_garmin_sid',
  'ra_runs',
  'ra_race',
  'ra_goal',
  'ra_checks',
  'ra_blurb',
  'ra_coachUrl',
  'ra_pending_import',
  'ra_pending_deletes',
  'ra_garmin_coach_ok'
];

function destination() {
  var keys = {};
  ALLOW.forEach(function (key) {
    try {
      var value = localStorage.getItem(key);
      if (typeof value === 'string') keys[key] = value;
    } catch (err) { /* private mode */ }
  });
  var params = new URLSearchParams(location.search);
  var payload = { keys: keys };
  var code = params.get('code');
  var state = params.get('state');
  if (code && state) payload.oauth = { code: code, state: state };
  var prefix = '/run-app';
  var path = location.pathname.indexOf(prefix) === 0 ? location.pathname.slice(prefix.length) : location.pathname;
  if (!path || path === '/index.html') path = '/';
  if (path.charAt(0) !== '/') path = '/' + path;
  if (payload.oauth || Object.keys(keys).length) path = '/';
  var target = NEXT + path;
  if (payload.oauth || Object.keys(keys).length) target += '#ra=' + encodeURIComponent(JSON.stringify(payload));
  return target;
}

function cleanup() {
  var jobs = [];
  if (navigator.serviceWorker) {
    jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (reg) { return reg.unregister(); }));
    }));
  }
  if (window.caches) {
    jobs.push(caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) { return caches.delete(key); }));
    }));
  }
  var timeout = new Promise(function (resolve) { setTimeout(resolve, 1200); });
  return Promise.race([Promise.all(jobs), timeout]);
}

cleanup().then(function () { location.replace(destination()); }, function () { location.replace(destination()); });
