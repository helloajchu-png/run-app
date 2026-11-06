'use strict';
const API='https://run-app-api.helloajchu.workers.dev';
const q=s=>document.querySelector(s);
const KEY='ra_community';
let mode='mock';
let token='';

function load(){try{return JSON.parse(localStorage.getItem(KEY))||null}catch{return null}}
function store(v){localStorage.setItem(KEY,JSON.stringify(v))}
async function pinHash(nick,pin){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nick.toLowerCase()+'|'+pin));return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function demo(){return {
  me:null,friends:['阿凱','小林'],
  posts:[
    {id:'d1',nickname:'阿凱',displayName:'阿凱',kind:'run',body:'晨跑 12.02 km',km:12.02,pace:'5:28/km',createdAt:'2026-11-05T21:10:00Z',likes:['小林']},
    {id:'d2',nickname:'小林',displayName:'小林',kind:'week',body:'本週 46 km，配速 5:40/km。下週拉長跑。',km:46,pace:'5:40/km',createdAt:'2026-11-04T12:00:00Z',likes:[]}
  ]
}}
function db(){return load()||demo()}
function snapshot(){
  const runs=RA.runs,km=runs.filter(r=>RA.daysAgo(r.date)<7&&r.durationSec>0);
  const dist=km.reduce((s,r)=>s+r.distanceKm,0),sec=km.reduce((s,r)=>s+r.durationSec,0);
  const g=RA.S.get('goal',null);
  return {weeklyKm:+dist.toFixed(1),avgPace:dist>0?RA.fmtP(sec/dist):'—',goalRace:g?`${RA.DN[g.dist]||g.dist+'km'} ${RA.fmtT(g.sec)}`:''};
}
async function probe(){const c=new AbortController();const t=setTimeout(()=>c.abort(),2500);try{const r=await fetch(API+'/health',{signal:c.signal});if(!r.ok)return false;const j=await r.json();return !!j.ok}catch{return false}finally{clearTimeout(t)}}
async function api(path,opt){const r=await fetch(API+path,{...opt,headers:{'Content-Type':'application/json',Authorization:token?('Bearer '+token):'',...(opt&&opt.headers)}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}

function renderGate(msg){q('#socialGate').hidden=false;q('#socialApp').hidden=true;q('#socialMsg').textContent=msg||''}
function renderApp(){
  const d=db();if(!d.me)return renderGate();
  q('#socialGate').hidden=true;q('#socialApp').hidden=false;
  q('#socialMode').textContent=mode==='api'?'已連上社群伺服器。只有好友看得到。':'示範模式：動態存在這台裝置。好友功能要等社群伺服器上線，才會跟別人同步。';
  const p=snapshot();
  q('#socialName').textContent=d.me.displayName||d.me.nickname;
  q('#meKm').textContent=String(p.weeklyKm);
  q('#mePace').textContent=p.avgPace;
  q('#meGoal').textContent=p.goalRace?('目標 '+p.goalRace):'尚未設定目標賽';
  if(document.activeElement!==q('#meBlurb'))q('#meBlurb').value=d.me.planBlurb||'';
  const mine=d.me.nickname;
  q('#socialFeed').innerHTML=d.posts.length?`<div class="feed">${d.posts.map(post=>{
    const liked=(post.likes||[]).includes(mine);
    return `<article><div class="who">${h(post.displayName||post.nickname)} · ${post.kind==='week'?'本週':'跑步'}</div><p>${h(post.body)}</p><button type="button" class="ghost like" data-like="${h(post.id)}">${liked?'已讚':'讚'} ${ (post.likes||[]).length}</button></article>`;
  }).join('')}</div>`:'<p class="muted">好友還沒有動態。</p>';
  q('#socialFeed').querySelectorAll('[data-like]').forEach(b=>b.onclick=()=>like(b.dataset.like));
}
function h(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

async function enter(create){
  const nick=q('#nickName').value.trim(),pin=q('#nickPin').value.trim();
  if(!/^.{2,16}$/.test(nick)||!/^\d{4}$/.test(pin)){q('#socialMsg').textContent='暱稱 2–16 字，PIN 為 4 位數字';return}
  if(mode==='api'){
    try{const j=await api(create?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify({nickname:nick,pin,displayName:nick})});token=j.token;const d=db();d.me={nickname:j.user.nickname,displayName:j.user.displayName,planBlurb:j.user.planBlurb||'',visibility:'friends'};store(d);await refresh()}
    catch(e){q('#socialMsg').textContent=e.message}return}
  const d=db(),hash=await pinHash(nick,pin);
  if(create){if(d.me&&d.me.nickname.toLowerCase()===nick.toLowerCase()){q('#socialMsg').textContent='這個暱稱在這台裝置已建立';return}d.me={nickname:nick,pinHash:hash,displayName:nick,planBlurb:'',visibility:'friends'};store(d);renderApp();return}
  if(!d.me||d.me.nickname.toLowerCase()!==nick.toLowerCase()||d.me.pinHash!==hash){q('#socialMsg').textContent='暱稱或 PIN 不對';return}
  renderApp();
}
async function shareWeek(){
  const d=db();if(!d.me)return;const p=snapshot();d.me.planBlurb=q('#meBlurb').value.trim();d.me.displayName=d.me.displayName||d.me.nickname;
  const body=`本週 ${p.weeklyKm} km，配速 ${p.avgPace}${p.goalRace?'，目標 '+p.goalRace:''}${d.me.planBlurb?'。'+d.me.planBlurb:''}`;
  if(mode==='api'){try{await api('/me',{method:'PUT',body:JSON.stringify({displayName:d.me.displayName,weeklyKm:p.weeklyKm,avgPace:p.avgPace,goalRace:p.goalRace,planBlurb:d.me.planBlurb,visibility:'friends'})});await api('/posts',{method:'POST',body:JSON.stringify({kind:'week',body,km:p.weeklyKm,pace:p.avgPace})});await refresh();return}catch(e){q('#friendMsg').textContent=e.message;return}}
  d.posts.unshift({id:'p'+Date.now(),nickname:d.me.nickname,displayName:d.me.displayName,kind:'week',body,km:p.weeklyKm,pace:p.avgPace,createdAt:new Date().toISOString(),likes:[]});
  store(d);renderApp();
}
async function addFriend(){
  const nick=q('#friendNick').value.trim();if(!nick)return;
  if(mode==='api'){try{await api('/friends',{method:'POST',body:JSON.stringify({nickname:nick})});q('#friendNick').value='';await refresh()}catch(e){q('#friendMsg').textContent=e.message}return}
  const d=db();if(d.friends.map(x=>x.toLowerCase()).includes(nick.toLowerCase())){q('#friendMsg').textContent='已經是好友';return}
  d.friends.push(nick);store(d);q('#friendNick').value='';q('#friendMsg').textContent='已記下 '+nick+'。示範模式不會跟對方的手機同步。';renderApp();
}
async function like(id){
  const d=db();const me=d.me&&d.me.nickname;if(!me)return;
  if(mode==='api'){try{await api('/posts/'+encodeURIComponent(id)+'/like',{method:'POST',body:'{}'});await refresh()}catch(e){q('#friendMsg').textContent=e.message}return}
  const post=d.posts.find(p=>p.id===id);if(!post)return;post.likes=post.likes||[];const i=post.likes.indexOf(me);if(i>=0)post.likes.splice(i,1);else post.likes.push(me);store(d);renderApp();
}
async function refresh(){
  if(mode!=='api'||!token){renderApp();return}
  const me=await api('/me');const feed=await api('/feed');
  const d=db();d.me={nickname:me.nickname,displayName:me.displayName,planBlurb:me.planBlurb||'',visibility:me.visibility||'friends'};
  d.posts=feed.posts||[];store(d);renderApp();
}
window.communityOnRun=function(r){
  const d=db();if(!d.me)return;
  const body=`${r.date} ${r.distanceKm.toFixed(2)} km · ${RA.fmtT(r.durationSec)} · 配速 ${RA.fmtP(r.durationSec/r.distanceKm)}`;
  if(mode==='api'&&token){api('/posts',{method:'POST',body:JSON.stringify({kind:'run',body,km:r.distanceKm,pace:RA.fmtP(r.durationSec/r.distanceKm)})}).then(refresh).catch(()=>{});return}
  d.posts.unshift({id:'p'+Date.now(),nickname:d.me.nickname,displayName:d.me.displayName||d.me.nickname,kind:'run',body,km:r.distanceKm,pace:RA.fmtP(r.durationSec/r.distanceKm),createdAt:new Date().toISOString(),likes:[]});
  store(d);renderApp();
};
q('#nickIn').onclick=()=>enter(false);
q('#nickUp').onclick=()=>enter(true);
q('#shareWeek').onclick=shareWeek;
q('#addFriend').onclick=addFriend;
q('#socialOut').onclick=()=>{token='';const d=db();d.me=null;store(d);renderGate('已登出')};
probe().then(ok=>{mode=ok?'api':'mock';const d=db();if(!d.me)renderGate(ok?'':'尚未連上社群伺服器，可先在這台裝置試用。');else renderApp()});
