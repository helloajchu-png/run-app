'use strict';
const q = s => document.querySelector(s);

function h(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function snapshot() {
  const runs = window.RA.runs;
  const km = runs.filter(r => window.RA.daysAgo(r.date) < 7 && r.durationSec > 0);
  const dist = km.reduce((s, r) => s + r.distanceKm, 0);
  const sec = km.reduce((s, r) => s + r.durationSec, 0);
  const g = window.RA.S.get('goal', null);
  return {
    weeklyKm: +dist.toFixed(1),
    avgPace: dist > 0 ? window.RA.fmtP(sec / dist) : '—',
    goalRace: g ? `${window.RA.DN[g.dist] || g.dist + 'km'} ${window.RA.fmtT(g.sec)}` : '',
  };
}
function me() { return window.RA_AUTH && window.RA_AUTH.user(); }

function render(feed) {
  const user = me();
  const stats = snapshot();
  if (user) q('#socialName').textContent = user.displayName || '我';
  q('#meKm').textContent = String(stats.weeklyKm);
  q('#mePace').textContent = stats.avgPace;
  q('#meGoal').textContent = stats.goalRace ? ('目標 ' + stats.goalRace) : '尚未設定目標賽';
  const blurb = q('#meBlurb');
  if (blurb && document.activeElement !== blurb) blurb.value = window.RA.S.get('blurb', '') || '';
  const others = (feed.athletes || []).filter(person => !person.mine);
  q('#athleteList').innerHTML = feed.locked
    ? `<p class="locknote">${h(feed.message || '打開公開之後，才看得到其他公開跑者。')}</p>`
    : (others.length
      ? others.map(person => `<div class="athlete"><b>${h(person.displayName)}</b><span>${h(person.weeklyKm)} km</span><span>${h(person.avgPace)}</span></div>`).join('')
      : '<p class="muted">還沒有其他公開的跑者。</p>');
  const posts = feed.posts || [];
  const own = feed.ownPosts || [];
  const visible = feed.locked ? own : posts;
  let html = '';
  if (feed.locked && own.length) html += '<p class="kicker">ONLY YOU</p><h2>只有你看得到</h2>';
  html += visible.length
    ? `<div class="feed">${visible.map(post => `<article><div class="who">${h(post.displayName || '跑者')} · ${post.kind === 'week' ? '本週' : '跑步'}</div><p>${h(post.body)}</p><button type="button" class="ghost like" data-like="${h(post.id)}">${post.liked ? '已讚' : '讚'} ${post.likeCount || 0}</button></article>`).join('')}</div>`
    : (feed.locked ? '<p class="muted">你還沒有動態。</p>' : '<p class="muted">還沒有公開的動態。</p>');
  q('#socialFeed').innerHTML = html;
  q('#socialFeed').querySelectorAll('[data-like]').forEach(button => { button.onclick = () => like(button.dataset.like); });
}

async function refresh() {
  if (!window.RA_AUTH || !window.RA_AUTH.token()) return;
  try {
    const feed = await window.RA_AUTH.api('/feed?today=' + encodeURIComponent(window.RA.today()));
    render(feed);
  } catch (err) {
    const box = q('#socialFeed');
    if (box) box.innerHTML = `<p class="muted">暫時讀不到動態。${h(err.message || '')}</p>`;
  }
}

async function shareWeek() {
  const blurb = q('#meBlurb').value.trim();
  window.RA.S.set('blurb', blurb);
  if (window.scheduleAccountSync) window.scheduleAccountSync();
  const stats = snapshot();
  const body = `本週 ${stats.weeklyKm} km，配速 ${stats.avgPace}${stats.goalRace ? '，目標 ' + stats.goalRace : ''}${blurb ? '。' + blurb : ''}`;
  try {
    await window.RA_AUTH.api('/posts', { method: 'POST', body: { kind: 'week', body, km: stats.weeklyKm, pace: stats.avgPace } });
    const user = me();
    q('#shareMsg').textContent = user && user.isPublic
      ? '已分享給其他公開的跑者。'
      : '已記下。你現在還沒公開，其他人看不到。打開公開後才會出現。';
    await refresh();
  } catch (err) {
    q('#shareMsg').textContent = err.message || '沒有分享';
  }
}

async function like(id) {
  try { await window.RA_AUTH.api('/posts/' + encodeURIComponent(id) + '/like', { method: 'POST', body: {} }); await refresh(); }
  catch (err) { q('#shareMsg').textContent = err.message || '沒有按讚'; }
}

window.communityOnRun = function (run) {
  if (!window.RA_AUTH || !window.RA_AUTH.token() || !(run.distanceKm > 0)) return;
  const body = `${run.date} ${Number(run.distanceKm).toFixed(2)} km · ${window.RA.fmtT(run.durationSec)} · 配速 ${window.RA.fmtP(run.durationSec / run.distanceKm)}`;
  window.RA_AUTH.api('/posts', {
    method: 'POST',
    body: { kind: 'run', body, km: run.distanceKm, pace: window.RA.fmtP(run.durationSec / run.distanceKm) },
  }).then(refresh).catch(() => {});
};

q('#shareWeek').onclick = shareWeek;
window.addEventListener('ra-ready', refresh);
window.addEventListener('ra-profile', refresh);
window.addEventListener('ra-locked', () => {
  const feed = q('#socialFeed');
  const athletes = q('#athleteList');
  if (feed) feed.innerHTML = '';
  if (athletes) athletes.innerHTML = '';
});
