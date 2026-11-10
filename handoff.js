'use strict';
// Reads a one-time handoff from the URL fragment (#ra=...), writes the
// allowlisted localStorage keys, and drops the fragment. Nothing is put in
// the query string. The GitHub Pages redirect uses the same shape.
(function () {
  var ALLOW = {
    ra_garmin_sid: 1,
    ra_runs: 1,
    ra_race: 1,
    ra_goal: 1,
    ra_checks: 1,
    ra_blurb: 1,
    ra_coachUrl: 1,
    ra_pending_import: 1,
    ra_pending_deletes: 1,
    ra_garmin_coach_ok: 1
  };
  var hash = location.hash || '';
  if (hash.indexOf('#ra=') !== 0) return;
  try {
    var data = JSON.parse(decodeURIComponent(hash.slice(4)));
    if (data && data.keys) {
      Object.keys(data.keys).forEach(function (key) {
        if (ALLOW[key] && typeof data.keys[key] === 'string') localStorage.setItem(key, data.keys[key]);
      });
    }
    if (data && data.oauth && data.oauth.code && data.oauth.state) {
      sessionStorage.setItem('ra_oauth_return', JSON.stringify({
        code: String(data.oauth.code),
        state: String(data.oauth.state)
      }));
    }
  } catch (err) { /* still strip a broken fragment */ }
  history.replaceState(null, '', location.pathname + location.search);
})();
