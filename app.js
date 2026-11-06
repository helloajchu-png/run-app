'use strict';
const $=s=>document.querySelector(s);
const S={get:(k,d)=>{try{return JSON.parse(localStorage.getItem('ra_'+k))??d}catch{return d}},set:(k,v)=>localStorage.setItem('ra_'+k,JSON.stringify(v))};
let runs=S.get('runs',[]);
const today=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)};
const parseT=s=>{if(!s)return NaN;const p=String(s).trim().split(':').map(Number);if(p.some(isNaN))return NaN;return p.reduce((a,b)=>a*60+b,0)};
const fmtT=sec=>{sec=Math.round(sec);const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s).padStart(2,'0')};
const fmtP=spk=>isFinite(spk)&&spk>0?fmtT(spk)+'/km':'—';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const daysAgo=d=>(Date.parse(today())-Date.parse(d))/864e5;
const DN={5:'5K',10:'10K',21.0975:'半馬',42.195:'全馬'};
function save(){S.set('runs',runs);renderAll()}

// ---------- tabs ----------
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,.tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.tab).classList.add('on');renderAll()});

// ---------- log ----------
$('#fDate').value=today();
const updPace=()=>{const d=+$('#fDist').value,t=parseT($('#fTime').value);$('#fPace').textContent='配速：'+(d>0&&t>0?fmtP(t/d):'—')};
['#fDist','#fTime'].forEach(s=>$(s).oninput=updPace);
$('#runForm').onsubmit=e=>{e.preventDefault();const t=parseT($('#fTime').value),d=+$('#fDist').value;if(!(t>0&&d>0))return alert('請輸入正確的距離與時間');
 const r={id:$('#editId').value||crypto.randomUUID?.()||String(Date.now()),date:$('#fDate').value,distanceKm:d,durationSec:t,avgHr:+$('#fHr').value||null,note:$('#fNote').value.trim(),source:'manual'};
 const editing=!!$('#editId').value;const i=runs.findIndex(x=>x.id===r.id);if(i>=0){r.source=runs[i].source;runs[i]=r}else runs.push(r);resetForm();save();if(!editing&&window.communityOnRun)window.communityOnRun(r)};
function resetForm(){$('#runForm').reset();$('#editId').value='';$('#fDate').value=today();$('#formTitle').textContent='新增跑步';$('#cancelEdit').hidden=true;updPace()}
$('#cancelEdit').onclick=resetForm;
function editRun(id){const r=runs.find(x=>x.id===id);if(!r)return;$('#editId').value=r.id;$('#fDate').value=r.date;$('#fDist').value=r.distanceKm;$('#fTime').value=fmtT(r.durationSec);$('#fHr').value=r.avgHr||'';$('#fNote').value=r.note||'';$('#formTitle').textContent='編輯跑步';$('#cancelEdit').hidden=false;updPace();scrollTo({top:0,behavior:'smooth'})}
function delRun(id){if(confirm('確定刪除這筆紀錄？')){runs=runs.filter(x=>x.id!==id);save()}}
function renderLog(){runs.sort((a,b)=>b.date.localeCompare(a.date));$('#runCount').textContent=`（${runs.length} 筆）`;
 $('#runList').innerHTML=runs.length?runs.map(r=>`<li><div class="run-body"><div class="run-top"><b>${r.date}</b><span class="run-fig">${r.distanceKm.toFixed(2)}</span><span class="unit">km</span><span class="run-time">${fmtT(r.durationSec)}</span></div><div class="meta">配速 ${fmtP(r.durationSec/r.distanceKm)}${r.avgHr?' · 心率 '+r.avgHr:''}${r.source&&r.source!=='manual'?' <span class="src">GARMIN</span>':''}${r.note?' · '+esc(r.note):''}</div></div><div class="acts"><button class="ghost" data-e="${r.id}">編輯</button><button class="danger" data-d="${r.id}">刪除</button></div></li>`).join(''):'<li class="muted">尚無紀錄</li>';
 $('#runList').querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>editRun(b.dataset.e));$('#runList').querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>delRun(b.dataset.d))}
$('#garminFile').onchange=async e=>{const files=[...e.target.files];if(!files.length)return;$('#importMsg').textContent='解析中…';
 try{const inc=await GarminImport.parseFiles(files);inc.forEach((r,i)=>{r.id='g'+Date.now()+'_'+i;r.note=r.note||''});
  const m=GarminImport.mergeRuns(runs,inc);runs=m.runs;save();
  $('#importMsg').textContent=`匯入 ${m.added} 筆，略過重複 ${m.skipped} 筆`+(inc.errors?.length?`；錯誤：${inc.errors.join('；')}`:'')}
 catch(err){$('#importMsg').textContent='匯入失敗：'+err.message}e.target.value=''};

// ---------- fitness ----------
const riegel=(t1,d1,d2)=>t1*Math.pow(d2/d1,1.06);
function vdot(km,sec){const t=sec/60,v=km*1000/t;const vo2=-4.6+0.182258*v+0.000104*v*v;const pct=0.8+0.1894393*Math.exp(-0.012778*t)+0.2989558*Math.exp(-0.1932605*t);return vo2/pct}
function vdotTime(V,km){let lo=km*120,hi=km*900;for(let i=0;i<60;i++){const m=(lo+hi)/2;vdot(km,m)>V?lo=m:hi=m}return (lo+hi)/2}
function paceAt(V,frac){const vo2=V*frac,a=0.000104,b=0.182258,c=-4.6-vo2;const v=(-b+Math.sqrt(b*b-4*a*c))/(2*a);return 60000/v} // sec/km
function bestEffort(){const c=[];const race=S.get('race',null);
 if(race&&race.sec>0&&(!race.date||daysAgo(race.date)<=120))c.push({km:race.dist,sec:race.sec,label:`比賽 ${DN[race.dist]||race.dist+'km'} ${fmtT(race.sec)}`});
 runs.filter(r=>daysAgo(r.date)<=56&&r.distanceKm>=3&&r.durationSec>0).forEach(r=>c.push({km:r.distanceKm,sec:r.durationSec,label:`${r.date} ${r.distanceKm.toFixed(1)}km ${fmtT(r.durationSec)}`}));
 c.forEach(x=>x.v=vdot(x.km,x.sec));c.sort((a,b)=>b.v-a.v);return c[0]||null}
function renderFit(){const race=S.get('race',null);if(race){$('#raceDist').value=String(race.dist);$('#raceTime').value=fmtT(race.sec);$('#raceDate').value=race.date||''}
 const b=bestEffort();if(!b){$('#predict').innerHTML='<p class="muted">請先記錄近 8 週內 3 公里以上的跑步，或輸入比賽成績。</p>';return}
 const V=b.v;
 const card=(label,time,sub)=>`<article class="stat"><p class="stat-label">${label}</p><p class="pred-num">${time}</p><p class="stat-sub">${sub}</p></article>`;
 $('#predict').innerHTML=`<p class="muted">依據 ${esc(b.label)} · VDOT ${V.toFixed(1)}</p><div class="pred-grid">${[5,10,21.0975,42.195].map(d=>card(DN[d],fmtT(vdotTime(V,d)),fmtP(vdotTime(V,d)/d))).join('')}</div><h2 style="margin-top:16px">訓練配速</h2><div class="pred-grid">${[['輕鬆 E',fmtP(paceAt(V,.70))],['馬拉松 M',fmtP(vdotTime(V,42.195)/42.195)],['閾值 T',fmtP(paceAt(V,.88))],['間歇 I',fmtP(paceAt(V,.975))]].map(([n,p])=>card(n,p,'每公里')).join('')}</div>`}
$('#saveRace').onclick=()=>{const sec=parseT($('#raceTime').value);if(!(sec>0))return alert('請輸入成績，例如 4:03:00');S.set('race',{dist:+$('#raceDist').value,sec,date:$('#raceDate').value});renderAll();alert('已儲存')};

// ---------- plan ----------
function weeklyKm(n=4){const w=[];for(let i=0;i<n;i++)w.push(runs.filter(r=>{const a=daysAgo(r.date);return a>=i*7&&a<i*7+7}).reduce((s,r)=>s+r.distanceKm,0));return w} // w[0]=this week
function genPlan(goal){const b=bestEffort();const V=b?b.v:vdot(goal.dist,goal.sec);const gV=vdot(goal.dist,goal.sec);
 const weeks=Math.max(1,Math.min(24,Math.ceil((Date.parse(goal.date)-Date.parse(today()))/(7*864e5))));
 const peakCap={5:40,10:48,21.0975:58,42.195:72}[goal.dist]||60,longCap={5:12,10:16,21.0975:21,42.195:32}[goal.dist]||20;
 const recent=weeklyKm(4);let base=Math.max({5:20,10:25,21.0975:30,42.195:35}[goal.dist]||25,recent.reduce((a,b)=>a+b,0)/4||0);
 const taper=goal.dist>=42?3:goal.dist>=21?2:1;const P={E:paceAt(V,.70),T:paceAt(V,.88),I:paceAt(V,.975),M:goal.sec/goal.dist,G:goal.sec/goal.dist};
 const out=[];let vol=base;
 for(let w=1;w<=weeks;w++){const left=weeks-w;let phase,km;
  if(w===weeks){phase='比賽週';km=Math.round(peakVol()*0.4)}
  else if(left<taper){phase='減量';km=Math.round(peakVol()*(left===taper-1?0.6:0.75))}
  else{if(w>1)vol=Math.min(peakCap,vol*1.07);km=Math.round(w%4===0?vol*0.8:vol);phase=w<=Math.ceil((weeks-taper)*0.4)?'基礎期':w<=Math.ceil((weeks-taper)*0.8)?'強化期':'巔峰期'}
  out.push({w,phase,km,days:days(phase,km,goal)})}
 function peakVol(){return Math.max(...out.map(x=>x.km),base)}
 function days(phase,km,g){const n=+g.days;if(phase==='比賽週')return[['週二','easy','輕鬆跑 6km + 4×100m 加速跑',P.E],['週四','mp',`目標配速 3km`,P.G],['比賽日','race',`${DN[g.dist]||g.dist+'km'} 目標 ${fmtT(g.sec)}`,P.G]];
  const long=Math.min(longCap,Math.max(8,Math.round(km*0.3)));const rest=km-long;const q=[];
  const hasInt=phase!=='基礎期',isMara=g.dist>=21;
  q.push(['週二',hasInt?'int':'easy',hasInt?`間歇 ${phase==='巔峰期'?6:5}×1000m（休 2–3 分）`:`輕鬆跑 ${Math.round(rest*.25)}km + 6×100m 加速跑`,hasInt?P.I:P.E]);
  q.push(['週四','tempo',`節奏跑 ${phase==='基礎期'?'15':phase==='強化期'?'25':'30'} 分鐘（含暖身緩和共 ${Math.round(rest*.28)}km）`,P.T]);
  const easyN=n-3;for(let i=0;i<easyN;i++)q.push([['週三','週六','週一'][i],'easy',`輕鬆跑 ${Math.max(4,Math.round(rest*.47/Math.max(1,easyN)))}km`,P.E]);
  const lr=isMara&&phase!=='基礎期'?`長跑 ${long}km，最後 ${Math.round(long*0.3)}km 用目標配速`:`長跑 ${long}km`;
  q.push(['週日','long',lr,P.E]);const O=['週一','週二','週三','週四','週五','週六','週日'];return q.sort((a,b)=>O.indexOf(a[0])-O.indexOf(b[0]))}
 return{V,gV,weeks,P,out}}
const TAG={easy:['輕鬆','t-easy'],long:['長跑','t-long'],tempo:['節奏','t-tempo'],int:['間歇','t-int'],mp:['配速','t-mp'],race:['比賽','t-race']};
function weekdayName(iso){const [y,m,d]=iso.split('-').map(Number);return ['週日','週一','週二','週三','週四','週五','週六'][new Date(y,m-1,d).getDay()]}
function thisWeek(){const [y,m,d]=today().split('-').map(Number);const dt=new Date(y,m-1,d);const day=dt.getDay();dt.setDate(dt.getDate()+(day===0?-6:1-day));const z=n=>String(n).padStart(2,'0');const names=['週一','週二','週三','週四','週五','週六','週日'];const out=[];for(let i=0;i<7;i++){const x=new Date(dt);x.setDate(dt.getDate()+i);out.push({name:names[i],iso:`${x.getFullYear()}-${z(x.getMonth()+1)}-${z(x.getDate())}`})}return out}
function checks(){return S.get('checks',{})||{}}
function renderPlan(){const g=S.get('goal',null);if(!g){$('#gDate').value='';$('#planOut').innerHTML='<div class="card"><p class="muted">先設定目標賽事。破 4 全馬請把目標時間填 3:59:00。</p></div>';return}
 $('#gDist').value=String(g.dist);$('#gDate').value=g.date;$('#gTime').value=fmtT(g.sec);$('#gDays').value=g.days;
 const p=genPlan(g);const pred=vdotTime(p.V,g.dist);const gap=pred-g.sec;const week=p.out[0];const byName={};
 if(week)week.days.forEach(d=>{byName[d[0]]=d});
 const done=checks();
 const cal=thisWeek().map(day=>{const hit=byName[day.name];const text=hit?`${TAG[hit[1]][0]} · ${hit[2]} · ${fmtP(hit[3])}`:'休息或交叉訓練';const on=!!done[day.iso];return `<label class="calday${day.iso===today()?' is-today':''}${on?' is-done':''}"><input type="checkbox" data-iso="${day.iso}"${on?' checked':''}><span class="calwhen">${day.name}<b>${day.iso.slice(5)}</b></span><span class="calwhat">${esc(text)}</span></label>`}).join('');
 $('#planOut').innerHTML=`<div class="card"><p class="kicker">THIS WEEK</p><h2>本週</h2><div class="weekcal">${cal}</div></div><div class="card"><p>距離比賽 <b>${p.weeks}</b> 週。目前預測 ${fmtT(pred)}（VDOT ${p.V.toFixed(1)}），目標需 VDOT ${p.gV.toFixed(1)}。${gap>0?`<br>還差約 ${fmtT(gap)}，${p.gV-p.V>3?'目標偏積極，建議穩定累積里程。':'持續訓練有機會達成！'}`:'<br>目前體能已達目標，維持即可。'}</p>
 <table><tr><td>輕鬆 / 長跑</td><td>${fmtP(p.P.E)}</td></tr><tr><td>目標配速</td><td>${fmtP(p.P.G)}</td></tr><tr><td>節奏 T</td><td>${fmtP(p.P.T)}</td></tr><tr><td>間歇 I</td><td>${fmtP(p.P.I)}</td></tr></table></div>`+
 p.out.slice(1).map(w=>`<div class="card wk"><h3>第 ${w.w} 週・${w.phase}・約 ${w.km} km</h3>${w.days.map(d=>`<div>${d[0]}　<span class="tag ${TAG[d[1]][1]}">${TAG[d[1]][0]}</span> ${esc(d[2])}　<span class="muted">${fmtP(d[3])}</span></div>`).join('')}<div class="muted">其餘日休息或交叉訓練</div></div>`).join('');
 $('#planOut').querySelectorAll('[data-iso]').forEach(inp=>inp.onchange=()=>{const c=checks();if(inp.checked)c[inp.dataset.iso]=1;else delete c[inp.dataset.iso];S.set('checks',c);inp.closest('.calday').classList.toggle('is-done',inp.checked)})}
$('#genPlan').onclick=()=>{const sec=parseT($('#gTime').value),date=$('#gDate').value;if(!(sec>0)||!date)return alert('請填寫比賽日期與目標時間');if(date<=today())return alert('比賽日期需在今天之後');S.set('goal',{dist:+$('#gDist').value,date,sec,days:$('#gDays').value});renderPlan()};

// ---------- coach (rule-based; LLM optional) ----------
function coachTips(){const T=[];const add=(c,t)=>T.push({c,t});
 if(!runs.length){add('','先記錄幾次跑步或匯入 Garmin 資料，教練就能給你建議。');return T}
 const w=weeklyKm(4),[w0,w1,w2,w3]=w;
 add('',`近四週里程（由近到遠）：${w.map(x=>x.toFixed(1)).join(' / ')} km`);
 if(w1>0&&w0>w1*1.1)add('warn',`本週里程比上週多 ${Math.round((w0/w1-1)*100)}%，超過 10% 原則，注意受傷風險。`);
 if(w1>0&&w2>0&&w3>0&&w1>=w2&&w2>=w3&&w1>w3*1.15)add('warn','已連續數週增量，建議安排一週減量（約 -20%）恢復。');
 const last=runs.reduce((a,r)=>r.date>a?r.date:a,'');const gap=daysAgo(last);if(gap>=5)add('warn',`已經 ${gap} 天沒跑步了，從輕鬆跑恢復節奏吧。`);
 const b=bestEffort();const g=S.get('goal',null);
 if(b){const V=b.v,E=paceAt(V,.70),Efast=paceAt(V,.76);const rec=runs.filter(r=>daysAgo(r.date)<=21);
  const easyish=rec.filter(r=>r.distanceKm<15);const tooFast=easyish.filter(r=>r.durationSec/r.distanceKm<Efast).length;
  if(easyish.length>=3&&tooFast/easyish.length>0.6)add('warn',`近 3 週 ${tooFast}/${easyish.length} 次跑得比輕鬆配速（${fmtP(E)}）快，八成以上的跑量應該輕鬆跑。`);
  else if(easyish.length>=3)add('good','輕鬆跑配速控制得不錯，維持這個節奏。');
  if(g){const pred=vdotTime(V,g.dist);const wk=Math.ceil((Date.parse(g.date)-Date.parse(today()))/(7*864e5));
   add(pred<=g.sec?'good':'',`目標 ${DN[g.dist]||''} ${fmtT(g.sec)}：目前預測 ${fmtT(pred)}，${pred<=g.sec?'已在目標範圍內！':'還差 '+fmtT(pred-g.sec)+'，剩 '+wk+' 週。'}`);
   if(g.dist>=42){const lr=Math.max(0,...runs.filter(r=>daysAgo(r.date)<=28).map(r=>r.distanceKm));if(lr<25&&wk<=10)add('warn',`近 4 週最長只跑 ${lr.toFixed(1)} km，全馬備賽建議逐步拉到 28–32 km 長跑。`);
    const avg=(w0+w1+w2+w3)/4;if(avg<40)add('',`平均週跑量 ${avg.toFixed(0)} km；破 4 全馬通常需要穩定 45–60 km/週。`)}}}
 const hr=runs.filter(r=>r.avgHr&&daysAgo(r.date)<=28);
 if(hr.length>=4){const s=[...hr].sort((a,b)=>a.date.localeCompare(b.date));const h=Math.floor(s.length/2);
  const eff=a=>a.reduce((x,r)=>x+(1000/(r.durationSec/r.distanceKm))/r.avgHr,0)/a.length; // speed per beat
  const e1=eff(s.slice(0,h)),e2=eff(s.slice(h));
  if(e2>e1*1.02)add('good','同樣心率下跑得更快了，有氧能力在進步！');else if(e2<e1*0.97)add('warn','相同配速心率偏高，可能疲勞累積或天氣炎熱，注意睡眠與恢復。');
  const hi=hr.filter(r=>r.avgHr>=165&&r.distanceKm<12).length;if(hi>=3)add('warn',`近 4 週有 ${hi} 次短程跑平均心率 ≥165，強度可能偏高。`)}
 else add('','記錄心率（或匯入 Garmin）可以獲得心率相關建議。');
 return T}
const COACH_API='https://run-app-coach.helloajchu.workers.dev';
function coachContext(){
 const race=S.get('race',null),goal=S.get('goal',null);
 const recent=[...runs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30).map(r=>({date:r.date,km:+r.distanceKm.toFixed(2),time:fmtT(r.durationSec),pace:fmtP(r.durationSec/r.distanceKm),hr:r.avgHr||null,note:r.note||'',source:r.source||'manual'}));
 const b=bestEffort();
 let fitness=null;
 if(b){const V=b.v;fitness={basis:b.label,vdot:+V.toFixed(1),predictions:[5,10,21.0975,42.195].map(d=>({dist:DN[d],riegel:fmtT(riegel(b.sec,b.km,d)),vdot:fmtT(vdotTime(V,d)),pace:fmtP(riegel(b.sec,b.km,d)/d)})),paces:{easy:fmtP(paceAt(V,.70)),tempo:fmtP(paceAt(V,.88)),interval:fmtP(paceAt(V,.975)),marathon:fmtP(vdotTime(V,42.195)/42.195)}}}
 let plan=null;
 if(goal&&goal.date){const p=genPlan(goal),pred=vdotTime(p.V,goal.dist);
  plan={goal:{dist:DN[goal.dist]||goal.dist,date:goal.date,time:fmtT(goal.sec),days:+goal.days},weeksOut:p.weeks,predicted:fmtT(pred),vdotNow:+p.V.toFixed(1),vdotNeeded:+p.gV.toFixed(1),paces:{easy:fmtP(p.P.E),goal:fmtP(p.P.G),tempo:fmtP(p.P.T),interval:fmtP(p.P.I)},weeks:p.out.map(w=>({week:w.w,phase:w.phase,km:w.km,days:w.days.map(d=>d[0]+' '+TAG[d[1]][0]+' '+d[2]+' '+fmtP(d[3]))}))}}
 return JSON.stringify({today:today(),weeklyKmRecentToOlder:weeklyKm(4).map(x=>+x.toFixed(1)),race:race?{dist:DN[race.dist]||race.dist,time:fmtT(race.sec),date:race.date||''}:null,recentRuns:recent,fitness,plan,ruleTips:coachTips().map(t=>t.t)})}
function coachEndpoint(){const v=($('#coachUrl')&&$('#coachUrl').value||S.get('coachUrl','')||'').trim().replace(/\/+$/,'');return v||COACH_API}
let chat=[];
function renderChat(){const el=$('#chatLog');if(!el)return;el.innerHTML=chat.length?chat.map(m=>`<div class="bubble ${m.role}"><span class="who">${m.role==='user'?'你':'教練'}</span><p>${esc(m.text).replace(/\n/g,'<br>')}</p></div>`).join(''):'<p class="muted">問一個具體的問題，例如配速、這週課表或恢復。</p>'}
let coachBusy=false;
function coachFail(ex){
 const j=ex&&ex.body||{}, raw=ex&&ex.raw||'', detail=j.detail||j.error||j.message||'';
 const blob=`${detail} ${raw} ${ex&&ex.message||''}`;
 if(!ex.status&&(ex.name==='TypeError'||/failed to fetch|networkerror|load failed|cors/i.test(ex.message||'')))return '網路或跨網域（CORS）連線失敗，請檢查網路後再試';
 if(/upstream/i.test(blob))return '送出失敗：upstream'+(j.detail?'：'+j.detail:(detail&&!/^upstream$/i.test(String(detail))?'：'+detail:''));
 return '送出失敗：'+(detail||raw.slice(0,160)||ex.message||('HTTP '+(ex.status||'')));
}
async function postChat(message,context){
 let r;
 try{r=await fetch(coachEndpoint()+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,context})})}
 catch(e){e.status=0;throw e}
 const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}
 if(!r.ok||typeof j.reply!=='string'){const err=new Error(j.error||j.message||raw.slice(0,160)||('HTTP '+r.status));err.status=r.status;err.body=j;err.raw=raw;throw err}
 return j.reply||'（沒有回覆）';
}
async function askCoach(){
 const btn=$('#chatSend'),box=$('#chatMsg'),err=$('#chatErr'),label=$('#chatSendLabel'),spin=$('#chatSpin');
 if(!btn||!box||coachBusy)return;
 const message=box.value.trim();
 if(!message){err.textContent='先寫下想問教練的問題';return}
 coachBusy=true;btn.disabled=true;err.textContent='';
 if(label)label.textContent='送出中…';if(spin)spin.hidden=false;
 chat.push({role:'user',text:message});
 const pending={role:'coach',text:'思考中…'};chat.push(pending);
 box.value='';renderChat();
 let context='{}';
 try{context=coachContext()}catch(err2){context=JSON.stringify({note:'上下文整理失敗',detail:String(err2)})}
 try{
  let reply;try{reply=await postChat(message,context)}catch(ex){
   if(/upstream/i.test(`${ex.message||''} ${ex.raw||''} ${(ex.body&&(ex.body.error||ex.body.detail))||''}`)){
    pending.text='上游忙碌，1 秒後重試…';renderChat();await new Promise(r=>setTimeout(r,1000));reply=await postChat(message,context);
   }else throw ex;
  }
  pending.text=reply;
 }catch(ex){
  if(chat[chat.length-1]===pending)chat.pop();
  if(chat[chat.length-1]&&chat[chat.length-1].role==='user')chat.pop();
  box.value=message;err.textContent=coachFail(ex);
 }finally{
  coachBusy=false;btn.disabled=false;if(label)label.textContent='送出';if(spin)spin.hidden=true;renderChat();
 }
}
const sendBtn=document.getElementById('chatSend');
if(sendBtn)sendBtn.addEventListener('click',askCoach);
$('#saveCoachUrl').onclick=()=>{const v=$('#coachUrl').value.trim();if(v)S.set('coachUrl',v);else localStorage.removeItem('ra_coachUrl');alert(v?'已改用自訂網址':'已恢復預設教練')};
function renderCoach(){$('#tips').innerHTML=coachTips().map(t=>`<div class="tip ${t.c}">${esc(t.t)}</div>`).join('');
 const urlEl=$('#coachUrl');if(urlEl&&document.activeElement!==urlEl)urlEl.value=S.get('coachUrl','')||'';renderChat()}
$('#exportBtn').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({runs,race:S.get('race'),goal:S.get('goal')},null,1)],{type:'application/json'}));a.download='runs.json';a.click()};
$('#clearBtn').onclick=()=>{if(confirm('清除所有資料？')){['runs','race','goal','checks'].forEach(k=>localStorage.removeItem('ra_'+k));runs=[];renderAll()}};
function todaySession(){const g=S.get('goal',null);const name=weekdayName(today());
 if(g&&g.date===today())return {title:'比賽',detail:`${DN[g.dist]||g.dist+'km'} 目標 ${fmtT(g.sec)}`,pace:fmtP(g.sec/g.dist),rest:false};
 if(!g||!g.date||g.date<today())return null;
 const week=genPlan(g).out[0];if(!week)return null;const hit=week.days.find(d=>d[0]===name);
 if(!hit)return {title:'休息',detail:`${week.phase}・本週約 ${week.km} km。今天沒有排跑，休息或輕度交叉訓練。`,rest:true};
 return {title:TAG[hit[1]][0],detail:hit[2],pace:fmtP(hit[3]),rest:false,phase:week.phase}}
function todayQuestion(){const s=todaySession();
 if(!s)return '我的目標是全馬破 4。今天沒有課表，該跑什麼、配速多少？';
 if(s.rest)return '今天課表是休息。以全馬破 4 來看，我可以完全休息，還是要做交叉訓練？';
 return `今天的課是${s.title}：${s.detail}${s.pace?'，配速 '+s.pace:''}。以全馬破 4，我該怎麼跑完今天？`}
function renderToday(){const el=$('#todayWorkout');if(!el)return;const s=todaySession();
 el.innerHTML=s?`<p class="today-kicker">${s.rest?'REST':'TODAY'} · ${weekdayName(today())}</p><p class="today-title">${esc(s.title)}</p><p class="today-detail">${esc(s.detail)}${s.pace&&!s.rest?'　'+esc(s.pace):''}</p>`:`<p class="today-kicker">TODAY · ${weekdayName(today())}</p><p class="today-title">先排課</p><p class="today-detail">還沒有進行中的課表。到「課表」把目標設成全馬 3:59:00，今天就能看到該跑什麼。</p>`}
const askTodayBtn=document.getElementById('askToday');
if(askTodayBtn)askTodayBtn.addEventListener('click',()=>{const box=$('#chatMsg');if(box)box.value=todayQuestion();const tab=document.querySelector('nav button[data-tab="coach"]');if(tab)tab.click();if(box)box.focus()});

// ---------- init ----------
if(!S.get('race',null))S.set('race',{dist:42.195,sec:parseT('4:03:00'),date:''});
function renderHero(){
 const SUB4=14400,BASE=6.5*3600,C=2*Math.PI*46;
 const b=bestEffort(),wk=weeklyKm(1)[0];
 const text=(id,v)=>{const el=$(id);if(el)el.textContent=v};
 text('#heroWeek',(Math.round(wk*10)/10).toFixed(1));
 const ring=$('#heroRingArc'),bar=$('#heroBar'),gapEl=$('#heroGap');
 let pct=0,slogan='今天就出門。熱血不等人。',ahead=false;
 if(!b){text('#heroMara','—');text('#heroVdot','—');text('#heroGap','—');text('#heroPct','0%');text('#heroGapLabel','距 SUB-4')}
 else{
  const V=b.v,mara=vdotTime(V,42.195),gap=mara-SUB4;
  pct=Math.max(0,Math.min(100,(BASE-mara)/(BASE-SUB4)*100));
  if(mara<=SUB4)pct=100;
  ahead=gap<=30;
  text('#heroMara',fmtT(mara));
  text('#heroVdot',V.toFixed(1));
  text('#heroGap',fmtT(Math.abs(gap)));
  text('#heroPct',Math.round(pct)+'%');
  text('#heroGapLabel',ahead?'領先 SUB-4':'距 SUB-4');
  slogan=ahead?'SUB-4 已在腳下。守住節奏，把它跑完。':gap<8*60?'終點線看得到了。再把配速咬住。':'每一公里都在把 4 小時拉近。';
 }
 text('#slogan',slogan);
 if(gapEl)gapEl.classList.toggle('ahead',ahead);
 const apply=()=>{
  if(ring){ring.style.strokeDasharray=String(C);ring.style.strokeDashoffset=String(C*(1-pct/100))}
  if(bar)bar.style.width=pct+'%';
 };
 requestAnimationFrame(()=>requestAnimationFrame(apply));
}
function renderAll(){renderLog();renderFit();renderPlan();renderCoach();renderHero();renderToday()}
renderAll();updPace();
const APP_VER='run-app-v10';
function showToast(msg){let el=$('#toast');if(!el){el=document.createElement('p');el.id='toast';el.className='toast';document.body.appendChild(el)}el.textContent=msg}
function noteUpdate(){const prev=localStorage.getItem('ra_sw');const back=!!(prev||navigator.serviceWorker?.controller);if(prev!==APP_VER&&back&&sessionStorage.getItem('ra_toasted')!==APP_VER){sessionStorage.setItem('ra_toasted',APP_VER);showToast('已更新，請再試一次')}localStorage.setItem('ra_sw',APP_VER)}
if('serviceWorker' in navigator){noteUpdate();navigator.serviceWorker.register('sw.js');navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.version)noteUpdate()});navigator.serviceWorker.addEventListener('controllerchange',noteUpdate)}
window.RA={get runs(){return runs},S,$,fmtP,fmtT,DN,today,daysAgo,weeklyKm};
