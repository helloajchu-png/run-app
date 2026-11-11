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
const GOAL_KM={ '5k':5, '10k':10, half:21.0975, marathon:42.195 };
const GOAL_NAME={ '5k':'5K', '10k':'10K', half:'半馬', marathon:'全馬', health:'健康跑' };
let goalProfile=null;
try{goalProfile=JSON.parse(localStorage.getItem('ra_goal_profile')||'null')}catch{goalProfile=null}
function goalName(p){return GOAL_NAME[p&&p.distance]||'跑步'}
function goalKm(p){return GOAL_KM[p&&p.distance]||null}
function planGoal(p){
 if(!p)return null;
 const days=String(Math.min(6,Math.max(2,Number(p.daysPerWeek)||4)));
 const dist=goalKm(p);
 const pace=p.paceSec||(p.level==='beginner'?420:360);
 let sec=p.targetSec||null;
 if(!sec&&dist&&p.paceSec)sec=Math.round(p.paceSec*dist);
 if(!sec&&dist){const b=bestEffort();if(b)sec=Math.round(vdotTime(b.v,dist))}
 if(!sec&&dist)sec=Math.round(pace*dist);
 let date=p.raceDate||'';
 const fitness=p.distance==='health';
 if(fitness){
  const end=new Date();end.setDate(end.getDate()+56);
  return {dist:10,date:end.toISOString().slice(0,10),sec:sec||pace*10,days,fitness:true,assumed:true,level:p.level||'intermediate',label:'健康跑',paceSec:pace};
 }
 if(!date){const weeks=dist>=42?16:dist>=21?12:8;const end=new Date();end.setDate(end.getDate()+weeks*7);date=end.toISOString().slice(0,10)}
 if(!dist||!sec)return null;
 return {dist,date,sec,days,fitness:false,assumed:!p.targetSec,level:p.level||'intermediate',label:goalName(p),paceSec:pace};
}
let accountSilent=false;
function save(){S.set('runs',runs);renderAll();if(!accountSilent&&window.scheduleAccountSync)window.scheduleAccountSync()}

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
function delRun(id){if(!confirm('確定刪除這筆紀錄？'))return;if(window.noteAccountDelete)window.noteAccountDelete(id);runs=runs.filter(x=>x.id!==id);save()}
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
 const focus=goalKm(goalProfile);
 const paces=[['輕鬆 E',fmtP(paceAt(V,.70))],['閾值 T',fmtP(paceAt(V,.88))],['間歇 I',fmtP(paceAt(V,.975))]];
 if(focus)paces.splice(1,0,[goalName(goalProfile),fmtP(vdotTime(V,focus)/focus)]);
 $('#predict').innerHTML=`<p class="muted">依據 ${esc(b.label)} · VDOT ${V.toFixed(1)}</p><div class="pred-grid">${[5,10,21.0975,42.195].map(d=>card(DN[d],fmtT(vdotTime(V,d)),fmtP(vdotTime(V,d)/d))).join('')}</div><h2 style="margin-top:16px">訓練配速</h2><div class="pred-grid">${paces.map(([n,p])=>card(n,p,'每公里')).join('')}</div>`}
$('#saveRace').onclick=()=>{const sec=parseT($('#raceTime').value);if(!(sec>0))return alert('請輸入成績，例如 25:00 或 1:45:00');S.set('race',{dist:+$('#raceDist').value,sec,date:$('#raceDate').value});renderAll();if(window.scheduleAccountSync)window.scheduleAccountSync();alert('已儲存')};

// ---------- plan ----------
function weeklyKm(n=4){const w=[];for(let i=0;i<n;i++)w.push(runs.filter(r=>{const a=daysAgo(r.date);return a>=i*7&&a<i*7+7}).reduce((s,r)=>s+r.distanceKm,0));return w} // w[0]=this week
function genPlan(goal){const b=bestEffort();const level=goal.level==='beginner'?'beginner':'intermediate';
 const V=b?b.v:(goal.paceSec?vdot(1,goal.paceSec):vdot(goal.dist,goal.sec));
 const gV=goal.assumed?V:vdot(goal.dist,goal.sec);
 const weeks=goal.fitness?8:Math.max(1,Math.min(24,Math.ceil((Date.parse(goal.date)-Date.parse(today()))/(7*864e5))||8));
 let peakCap={5:40,10:48,21.0975:58,42.195:72}[goal.dist]||40,longCap={5:12,10:16,21.0975:21,42.195:32}[goal.dist]||14;
 let baseFloor={5:20,10:25,21.0975:30,42.195:35}[goal.dist]||20;
 if(goal.fitness){peakCap=level==='beginner'?25:40;longCap=level==='beginner'?10:16;baseFloor=level==='beginner'?12:20}
 else if(level==='beginner'){peakCap=Math.round(peakCap*0.75);longCap=Math.round(longCap*0.8);baseFloor=Math.round(baseFloor*0.75)}
 const recent=weeklyKm(4);let base=Math.max(baseFloor,recent.reduce((a,c)=>a+c,0)/4||0);
 const taper=goal.fitness?0:goal.dist>=42?3:goal.dist>=21?2:1;
 const goalPace=goal.sec/goal.dist;
 const P={E:paceAt(V,.70),T:paceAt(V,.88),I:paceAt(V,.975),M:goalPace,G:goal.assumed?paceAt(V,.80):goalPace};
 const out=[];let vol=base;
 for(let w=1;w<=weeks;w++){const left=weeks-w;let phase,km;
  if(!goal.fitness&&w===weeks){phase='比賽週';km=Math.round(peakVol()*0.4)}
  else if(!goal.fitness&&left<taper){phase='減量';km=Math.round(peakVol()*(left===taper-1?0.6:0.75))}
  else{if(w>1)vol=Math.min(peakCap,vol*1.07);km=Math.round(w%4===0?vol*0.8:vol);phase=w<=Math.ceil((weeks-taper)*0.4)?'基礎期':w<=Math.ceil((weeks-taper)*0.8)?'強化期':'巔峰期'}
  out.push({w,phase,km,days:days(phase,km,goal)})}
 function peakVol(){return Math.max(...out.map(x=>x.km),base)}
 function days(phase,km,g){const n=+g.days;if(phase==='比賽週')return[['週二','easy','輕鬆跑 6km + 4×100m 加速跑',P.E],['週四','mp','目標配速 3km',P.G],['比賽日','race',`${g.label||DN[g.dist]||''} 目標 ${fmtT(g.sec)}`,P.G]];
  const longMin=g.fitness?6:8;
  const long=Math.min(longCap,Math.max(longMin,Math.round(km*0.3)));const rest=Math.max(0,km-long);const q=[];
  const hasInt=phase!=='基礎期'&&level!=='beginner'&&!g.fitness,useGoal=g.dist>=21&&!g.assumed;
  q.push(['週二',hasInt?'int':'easy',hasInt?`間歇 ${phase==='巔峰期'?6:5}×1000m（休 2–3 分）`:`輕鬆跑 ${Math.max(3,Math.round(rest*.25))}km + 6×100m 加速跑`,hasInt?P.I:P.E]);
  q.push(['週四','tempo',`節奏跑 ${phase==='基礎期'?'15':phase==='強化期'?'25':'20'} 分鐘（含暖身緩和共 ${Math.max(4,Math.round(rest*.28))}km）`,P.T]);
  const easyN=Math.max(0,n-3);for(let i=0;i<easyN;i++)q.push([['週三','週六','週一'][i],'easy',`輕鬆跑 ${Math.max(3,Math.round(rest*.47/Math.max(1,easyN)))}km`,P.E]);
  const lr=useGoal&&phase!=='基礎期'?`長跑 ${long}km，最後 ${Math.max(1,Math.round(long*0.3))}km 用目標配速`:`長跑 ${long}km`;
  q.push(['週日','long',lr,P.E]);const O=['週一','週二','週三','週四','週五','週六','週日'];return q.sort((a,b)=>O.indexOf(a[0])-O.indexOf(b[0]))}
 return{V,gV,weeks,P,out}}
const TAG={easy:['輕鬆','t-easy'],long:['長跑','t-long'],tempo:['節奏','t-tempo'],int:['間歇','t-int'],mp:['配速','t-mp'],race:['比賽','t-race']};
function weekdayName(iso){const [y,m,d]=iso.split('-').map(Number);return ['週日','週一','週二','週三','週四','週五','週六'][new Date(y,m-1,d).getDay()]}
function thisWeek(){const [y,m,d]=today().split('-').map(Number);const dt=new Date(y,m-1,d);const day=dt.getDay();dt.setDate(dt.getDate()+(day===0?-6:1-day));const z=n=>String(n).padStart(2,'0');const names=['週一','週二','週三','週四','週五','週六','週日'];const out=[];for(let i=0;i<7;i++){const x=new Date(dt);x.setDate(dt.getDate()+i);out.push({name:names[i],iso:`${x.getFullYear()}-${z(x.getMonth()+1)}-${z(x.getDate())}`})}return out}
function checks(){return S.get('checks',{})||{}}
function renderPlan(){const stored=goalProfile;const g=planGoal(stored);if(!g){$('#planOut').innerHTML='<div class="card"><p class="muted">先設定你的目標。可以是 5K、10K、半馬、全馬，或只是為了健康跑。</p></div>';return}
 const p=genPlan(g);const pred=g.fitness?null:vdotTime(p.V,g.dist);const gap=pred==null?0:pred-g.sec;const week=p.out[0];const byName={};
 if(week)week.days.forEach(d=>{byName[d[0]]=d});
 const done=checks();
 const cal=thisWeek().map(day=>{const hit=byName[day.name];const text=hit?`${TAG[hit[1]][0]} · ${hit[2]} · ${fmtP(hit[3])}`:'休息或交叉訓練';const on=!!done[day.iso];return `<label class="calday${day.iso===today()?' is-today':''}${on?' is-done':''}"><input type="checkbox" data-iso="${day.iso}"${on?' checked':''}><span class="calwhen">${day.name}<b>${day.iso.slice(5)}</b></span><span class="calwhat">${esc(text)}</span></label>`}).join('');
 const summary=g.fitness?`這是 ${p.weeks} 週的健康跑，沒有比賽日。配速依你目前的跑力（VDOT ${p.V.toFixed(1)}）。`:stored.targetSec?`距離比賽 <b>${p.weeks}</b> 週。目前預測 ${fmtT(pred)}（VDOT ${p.V.toFixed(1)}），目標 ${fmtT(stored.targetSec)}。${gap>0?`<br>還差約 ${fmtT(gap)}，${p.gV-p.V>3?'目標偏積極，建議穩定累積里程。':'持續訓練有機會達成！'}`:'<br>目前體能已達目標，維持即可。'}`:`還沒填目標完賽時間，這 ${p.weeks} 週依目前配速安排（VDOT ${p.V.toFixed(1)}）。預測 ${goalName(stored)} ${fmtT(pred)}。`;
 $('#planOut').innerHTML=`<div class="card"><p class="kicker">THIS WEEK</p><h2>本週</h2><div class="weekcal">${cal}</div></div><div class="card"><p>${summary}</p>
 <table><tr><td>輕鬆 / 長跑</td><td>${fmtP(p.P.E)}</td></tr><tr><td>目標配速</td><td>${fmtP(p.P.G)}</td></tr><tr><td>節奏 T</td><td>${fmtP(p.P.T)}</td></tr><tr><td>間歇 I</td><td>${fmtP(p.P.I)}</td></tr></table></div>`+
 p.out.slice(1).map(w=>`<div class="card wk"><h3>第 ${w.w} 週・${w.phase}・約 ${w.km} km</h3>${w.days.map(d=>`<div>${d[0]}　<span class="tag ${TAG[d[1]][1]}">${TAG[d[1]][0]}</span> ${esc(d[2])}　<span class="muted">${fmtP(d[3])}</span></div>`).join('')}<div class="muted">其餘日休息或交叉訓練</div></div>`).join('');
 $('#planOut').querySelectorAll('[data-iso]').forEach(inp=>inp.onchange=()=>{const c=checks();if(inp.checked)c[inp.dataset.iso]=1;else delete c[inp.dataset.iso];S.set('checks',c);inp.closest('.calday').classList.toggle('is-done',inp.checked);if(window.scheduleAccountSync)window.scheduleAccountSync()})}
const editGoalBtn=document.getElementById('editGoal');
if(editGoalBtn)editGoalBtn.addEventListener('click',()=>openGoal(false));

// ---------- coach (rule-based; LLM optional) ----------
function coachTips(){const T=[];const add=(c,t)=>T.push({c,t});
 if(!runs.length){add('','先記錄幾次跑步或匯入 Garmin 資料，教練就能給你建議。');return T}
 const w=weeklyKm(4),[w0,w1,w2,w3]=w;
 add('',`近四週里程（由近到遠）：${w.map(x=>x.toFixed(1)).join(' / ')} km`);
 if(w1>0&&w0>w1*1.1)add('warn',`本週里程比上週多 ${Math.round((w0/w1-1)*100)}%，超過 10% 原則，注意受傷風險。`);
 if(w1>0&&w2>0&&w3>0&&w1>=w2&&w2>=w3&&w1>w3*1.15)add('warn','已連續數週增量，建議安排一週減量（約 -20%）恢復。');
 const last=runs.reduce((a,r)=>r.date>a?r.date:a,'');const gap=daysAgo(last);if(gap>=5)add('warn',`已經 ${gap} 天沒跑步了，從輕鬆跑恢復節奏吧。`);
 const b=bestEffort();
 if(b){const V=b.v,E=paceAt(V,.70),Efast=paceAt(V,.76);const rec=runs.filter(r=>daysAgo(r.date)<=21);
  const easyish=rec.filter(r=>r.distanceKm<15);const tooFast=easyish.filter(r=>r.durationSec/r.distanceKm<Efast).length;
  if(easyish.length>=3&&tooFast/easyish.length>0.6)add('warn',`近 3 週 ${tooFast}/${easyish.length} 次跑得比輕鬆配速（${fmtP(E)}）快，八成以上的跑量應該輕鬆跑。`);
  else if(easyish.length>=3)add('good','輕鬆跑配速控制得不錯，維持這個節奏。');
  const profileGoal=planGoal(goalProfile);
  if(profileGoal&&!profileGoal.fitness){const pred=vdotTime(V,profileGoal.dist);const hasDate=!!(goalProfile&&goalProfile.raceDate);const wk=hasDate?Math.ceil((Date.parse(goalProfile.raceDate)-Date.parse(today()))/(7*864e5)):0;
   const targetBit=goalProfile.targetSec?fmtT(goalProfile.targetSec):'依目前配速';
   add(!goalProfile.targetSec||pred<=goalProfile.targetSec?'good':'',`目標 ${goalName(goalProfile)} ${targetBit}：目前預測 ${fmtT(pred)}${goalProfile.targetSec?(pred<=goalProfile.targetSec?'，已在目標範圍內！':'，還差 '+fmtT(pred-goalProfile.targetSec)):''}${hasDate?'，剩 '+wk+' 週。':'。'}`);
   const longNeed={marathon:goalProfile.level==='beginner'?24:28,half:goalProfile.level==='beginner'?14:18,'10k':12,'5k':8}[goalProfile.distance];
   const weekNeed={marathon:goalProfile.level==='beginner'?35:50,half:goalProfile.level==='beginner'?25:35,'10k':25,'5k':20}[goalProfile.distance];
   if(longNeed){const lr=Math.max(0,...runs.filter(r=>daysAgo(r.date)<=28).map(r=>r.distanceKm));if(lr<longNeed)add('warn',`近 4 週最長只跑 ${lr.toFixed(1)} km，${goalName(goalProfile)} 備賽可以逐步拉到約 ${longNeed} km 長跑。`);
    const avg=(w0+w1+w2+w3)/4;if(avg<weekNeed)add('',`平均週跑量 ${avg.toFixed(0)} km；以你的${goalName(goalProfile)}目標，穩定約 ${weekNeed} km/週會比較從容。`)}}
  else if(goalProfile&&goalProfile.distance==='health'){const avg=(w0+w1+w2+w3)/4;add('',`健康跑不排比賽。近四週平均 ${avg.toFixed(0)} km，維持每週 ${goalProfile.daysPerWeek||3} 天輕鬆跑就好。`)}}
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
 const allow=localStorage.getItem('ra_garmin_coach_ok')==='1';
 const kept=runs;
 if(!allow) runs=runs.filter(r=>r.source!=='garmin');
 try{
 const race=S.get('race',null),goal=planGoal(goalProfile);
 const recent=[...runs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30).map(r=>({date:r.date,km:+r.distanceKm.toFixed(2),time:fmtT(r.durationSec),pace:fmtP(r.durationSec/r.distanceKm),hr:r.avgHr||null,note:r.note||'',source:r.source||'manual'}));
 const b=bestEffort();
 let fitness=null;
 if(b){const V=b.v;fitness={basis:b.label,vdot:+V.toFixed(1),predictions:[5,10,21.0975,42.195].map(d=>({dist:DN[d],riegel:fmtT(riegel(b.sec,b.km,d)),vdot:fmtT(vdotTime(V,d)),pace:fmtP(riegel(b.sec,b.km,d)/d)})),paces:{easy:fmtP(paceAt(V,.70)),tempo:fmtP(paceAt(V,.88)),interval:fmtP(paceAt(V,.975)),marathon:fmtP(vdotTime(V,42.195)/42.195)}}}
 let plan=null;
 if(goal&&goal.date){const p=genPlan(goal),pred=goal.fitness?null:vdotTime(p.V,goal.dist);
  plan={goal:{dist:goal.label||DN[goal.dist]||goal.dist,date:goalProfile&&goalProfile.raceDate||'',time:goalProfile&&goalProfile.targetSec?fmtT(goalProfile.targetSec):'依目前配速',days:+goal.days,fitness:!!goal.fitness},weeksOut:p.weeks,predicted:pred?fmtT(pred):null,vdotNow:+p.V.toFixed(1),vdotNeeded:+p.gV.toFixed(1),paces:{easy:fmtP(p.P.E),goal:fmtP(p.P.G),tempo:fmtP(p.P.T),interval:fmtP(p.P.I)},weeks:p.out.map(w=>({week:w.w,phase:w.phase,km:w.km,days:w.days.map(d=>d[0]+' '+TAG[d[1]][0]+' '+d[2]+' '+fmtP(d[3]))}))}}
 const profile=goalProfile?{distance:goalProfile.distance,label:goalName(goalProfile),targetTime:goalProfile.targetSec?fmtT(goalProfile.targetSec):null,raceDate:goalProfile.raceDate||null,currentPace:goalProfile.paceSec?fmtP(goalProfile.paceSec):null,daysPerWeek:goalProfile.daysPerWeek,level:goalProfile.level==='beginner'?'入門':'有基礎'}:null;
 return JSON.stringify({today:today(),weeklyKmRecentToOlder:weeklyKm(4).map(x=>+x.toFixed(1)),garminIncluded:allow,goalProfile:profile,race:race?{dist:DN[race.dist]||race.dist,time:fmtT(race.sec),date:race.date||''}:null,recentRuns:recent,fitness,plan,ruleTips:coachTips().map(t=>t.t)});
 }finally{runs=kept}
}
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
function coachContextText(context){
 if(typeof context==='string')return context;
 try{return JSON.stringify(context??{})}catch(err){return JSON.stringify({note:'上下文無法序列化',detail:String(err)})}
}
async function postChat(message,context){
 let r;
 const body=JSON.stringify({message,context:coachContextText(context)});
 try{r=await fetch(coachEndpoint()+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body})}
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
$('#saveCoachUrl').onclick=()=>{const v=$('#coachUrl').value.trim();if(v)S.set('coachUrl',v);else localStorage.removeItem('ra_coachUrl');if(window.scheduleAccountSync)window.scheduleAccountSync();alert(v?'已改用自訂網址':'已恢復預設教練')};
function renderCoach(){$('#tips').innerHTML=coachTips().map(t=>`<div class="tip ${t.c}">${esc(t.t)}</div>`).join('');
 const urlEl=$('#coachUrl');if(urlEl&&document.activeElement!==urlEl)urlEl.value=S.get('coachUrl','')||'';renderChat()}
$('#exportBtn').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({runs,race:S.get('race'),goal:S.get('goal')},null,1)],{type:'application/json'}));a.download='runs.json';a.click()};
$('#clearBtn').onclick=()=>{if(!confirm('清除所有訓練資料？帳號裡的紀錄、比賽與目標也會刪掉。'))return;if(window.noteAccountDelete)runs.forEach(r=>window.noteAccountDelete(r.id));['runs','race','goal','checks','blurb'].forEach(k=>localStorage.removeItem('ra_'+k));runs=[];renderAll();if(window.scheduleAccountSync)window.scheduleAccountSync()};
function goalPhrase(){const p=goalProfile;if(!p)return '我還沒有設定目標';const time=p.targetSec?` ${fmtT(p.targetSec)}`:'';return `我的目標是${goalName(p)}${time}`}
function todaySession(){const g=planGoal(goalProfile);const name=weekdayName(today());
 if(goalProfile&&goalProfile.raceDate===today())return {title:'比賽',detail:`${goalName(goalProfile)}${goalProfile.targetSec?' 目標 '+fmtT(goalProfile.targetSec):''}`,pace:g?fmtP(g.sec/g.dist):'',rest:false};
 if(!g)return null;
 const week=genPlan(g).out[0];if(!week)return null;const hit=week.days.find(d=>d[0]===name);
 if(!hit)return {title:'休息',detail:`${week.phase}・本週約 ${week.km} km。今天沒有排跑，休息或輕度交叉訓練。`,rest:true};
 return {title:TAG[hit[1]][0],detail:hit[2],pace:fmtP(hit[3]),rest:false,phase:week.phase}}
function todayQuestion(){const s=todaySession();const who=goalPhrase();
 if(!s)return `${who}。今天沒有課表，該跑什麼、配速多少？`;
 if(s.rest)return `今天課表是休息。以「${who}」來看，我可以完全休息，還是要做交叉訓練？`;
 return `今天的課是${s.title}：${s.detail}${s.pace?'，配速 '+s.pace:''}。以「${who}」，我該怎麼跑完今天？`}
function renderToday(){const el=$('#todayWorkout');if(!el)return;const s=todaySession();
 el.innerHTML=s?`<p class="today-kicker">${s.rest?'REST':'TODAY'} · ${weekdayName(today())}</p><p class="today-title">${esc(s.title)}</p><p class="today-detail">${esc(s.detail)}${s.pace&&!s.rest?'　'+esc(s.pace):''}</p>`:`<p class="today-kicker">TODAY · ${weekdayName(today())}</p><p class="today-title">${goalProfile?'今天輕鬆':'先設定目標'}</p><p class="today-detail">${goalProfile?'今天沒有排跑。休息，或自己跑一段輕鬆的。':'先告訴教練你想跑 5K、10K、半馬、全馬，還是只為了健康。'}</p>`}
const askTodayBtn=document.getElementById('askToday');
if(askTodayBtn)askTodayBtn.addEventListener('click',()=>{const box=$('#chatMsg');if(box)box.value=todayQuestion();const tab=document.querySelector('nav button[data-tab="coach"]');if(tab)tab.click();if(box)box.focus()});

// ---------- init ----------
function renderHero(){
 const C=2*Math.PI*46;
 const b=bestEffort(),wk=weeklyKm(1)[0];
 const text=(id,v)=>{const el=$(id);if(el)el.textContent=v};
 text('#heroWeek',(Math.round(wk*10)/10).toFixed(1));
 const ring=$('#heroRingArc'),bar=$('#heroBar'),gapEl=$('#heroGap');
 const p=goalProfile,km=goalKm(p);
 let pct=0,slogan='今天就出門。熱血不等人。',ahead=false;
 const setRing=name=>{const el=$('#heroRingName');if(el)el.textContent=name;const wrap=$('.ring-wrap');if(wrap)wrap.setAttribute('aria-label',name+' 進度')};
 if(!p){text('#heroRaceLabel','預測成績');text('#heroMara','—');text('#heroRaceSub','先設定你的目標');text('#heroVdot','—');text('#heroGap','—');text('#heroPct','0%');text('#heroGapLabel','距目標');setRing('目標')}
 else if(!km){
  const days=Math.min(6,Math.max(2,Number(p.daysPerWeek)||3));
  const ran=new Set(runs.filter(r=>daysAgo(r.date)>=0&&daysAgo(r.date)<7).map(r=>r.date)).size;
  pct=Math.max(0,Math.min(100,ran/days*100));
  text('#heroRaceLabel','本週出跑');text('#heroMara',String(ran));text('#heroRaceSub',`健康跑 · 每週 ${days} 天`);
  text('#heroVdot',b?b.v.toFixed(1):'—');text('#heroGap',days-ran>0?String(days-ran):'0');text('#heroPct',Math.round(pct)+'%');text('#heroGapLabel','還差天數');
  setRing('健康');slogan=ran>=days?'這週的天數跑滿了。留一點力氣給下週。':'今天跑得輕鬆就好。';
 }else{
  const pace=p.paceSec||(p.level==='beginner'?420:360);
  const target=p.targetSec||Math.round(pace*km);
  const V=b?b.v:(p.paceSec?vdot(1,p.paceSec):null);
  const pred=V?vdotTime(V,km):null;
  text('#heroRaceLabel','預測'+goalName(p));
  text('#heroRaceSub',(p.targetSec?`目標 ${fmtT(p.targetSec)}`:'依目前配速')+` · ${km} km`);
  setRing(goalName(p));
  if(!pred){text('#heroMara','—');text('#heroVdot','—');text('#heroGap','—');text('#heroPct','0%');text('#heroGapLabel','距目標')}
  else{
   const slow=target*1.35,gap=pred-target;
   pct=Math.max(0,Math.min(100,(slow-pred)/(slow-target)*100));
   if(pred<=target)pct=100;
   ahead=gap<=30;
   text('#heroMara',fmtT(pred));text('#heroVdot',V.toFixed(1));text('#heroGap',fmtT(Math.abs(gap)));text('#heroPct',Math.round(pct)+'%');
   text('#heroGapLabel',p.targetSec?(ahead?'領先目標':'距目標'):'與配速差');
   slogan=p.targetSec?(ahead?'目標已在腳下。守住節奏，把它跑完。':gap<8*60?'終點線看得到了。再把配速咬住。':'每一公里都在把目標拉近。'):'課表先跟著你現在的配速走。';
  }
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
function goalField(name){return document.querySelector('#goalForm [data-goal="'+name+'"]')}
function fillGoalForm(){
 const p=goalProfile||{};
 const dist=goalField('distance');if(!dist)return;
 dist.value=p.distance||'half';
 const target=goalField('target');if(target)target.value=p.targetSec?fmtT(p.targetSec):'';
 const date=goalField('date');if(date)date.value=p.raceDate||'';
 const pace=goalField('pace');if(pace)pace.value=p.paceSec?fmtT(p.paceSec):'';
 const days=goalField('days');if(days)days.value=String(p.daysPerWeek||4);
 const level=goalField('level');if(level)level.value=p.level||'intermediate';
 const raceBits=document.getElementById('goalRaceFields');
 if(raceBits)raceBits.hidden=dist.value==='health';
}
function readGoalForm(){
 const distance=goalField('distance').value;
 const target=parseT(goalField('target').value);
 const pace=parseT(goalField('pace').value);
 const date=goalField('date').value;
 return {distance,targetSec:target>0?Math.round(target):null,raceDate:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:null,paceSec:pace>0?Math.round(pace):null,daysPerWeek:Number(goalField('days').value),level:goalField('level').value};
}
function applyGoalProfile(p,opts){
 goalProfile=p||null;
 if(p)localStorage.setItem('ra_goal_profile',JSON.stringify(p));
 else localStorage.removeItem('ra_goal_profile');
 if(p&&p.distance==='health')localStorage.removeItem('ra_goal');
 else if(p&&p.distance!=='health'&&p.raceDate&&(p.targetSec||p.paceSec)){
  const g=planGoal(p);
  if(g)S.set('goal',{dist:g.dist,date:p.raceDate,sec:p.targetSec||g.sec,days:g.days});
 }
 fillGoalForm();
 if(!opts||!opts.silent)renderAll();
 const skip=document.getElementById('goalSkip');
 if(skip)skip.hidden=!!p;
 if(!opts||!opts.keepOpen)document.body.classList.toggle('picking',!p);
}
function openGoal(first){
 fillGoalForm();
 const skip=document.getElementById('goalSkip');
 if(skip)skip.hidden=!first;
 document.body.classList.add('picking');
}
async function saveGoal(body){
 const res=await window.RA_AUTH.api('/goal',{method:'PUT',body});
 applyGoalProfile(res.goalProfile);
 document.body.classList.remove('picking');
 if(window.scheduleAccountSync)window.scheduleAccountSync();
}
const APP_VER='run-app-v16';
function showToast(msg){let el=$('#toast');if(!el){el=document.createElement('p');el.id='toast';el.className='toast';document.body.appendChild(el)}el.textContent=msg}
function noteUpdate(){const prev=localStorage.getItem('ra_sw');const back=!!(prev||navigator.serviceWorker?.controller);if(prev!==APP_VER&&back&&sessionStorage.getItem('ra_toasted')!==APP_VER){sessionStorage.setItem('ra_toasted',APP_VER);showToast('已更新，請再試一次')}localStorage.setItem('ra_sw',APP_VER)}
if('serviceWorker' in navigator){noteUpdate();navigator.serviceWorker.register('sw.js');navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.version)noteUpdate()});navigator.serviceWorker.addEventListener('controllerchange',noteUpdate)}
const goalForm=document.getElementById('goalForm');
if(goalForm){
 goalField('distance').addEventListener('change',()=>{const box=document.getElementById('goalRaceFields');if(box)box.hidden=goalField('distance').value==='health'});
 goalForm.addEventListener('submit',async e=>{e.preventDefault();const msg=document.getElementById('goalMsg');msg.textContent='儲存中…';try{await saveGoal(readGoalForm());msg.textContent='已存進這個帳號。'}catch(err){msg.textContent=err.message||'沒有儲存'}});
}
const goalSkip=document.getElementById('goalSkip');
if(goalSkip)goalSkip.addEventListener('click',async()=>{const msg=document.getElementById('goalMsg');msg.textContent='儲存中…';try{await saveGoal({distance:'health',daysPerWeek:3,level:'beginner'})}catch(err){msg.textContent=err.message||'沒有儲存'}});
window.importGarminRuns=function(list){
 const shaped=(list||[]).map(r=>({id:('g'+String(r.activityId||Date.now())+'_'+Math.random().toString(36).slice(2,8)).replace(/[^A-Za-z0-9_-]/g,'').slice(0,80),date:r.date,distanceKm:+r.distanceKm,durationSec:+r.durationSec,avgHr:r.avgHr||null,note:r.note||'',source:'garmin'}));
 const m=GarminImport.mergeRuns(runs,shaped);runs=m.runs;save();return m};
window.RA={
 get runs(){return runs},
 setRuns(next){accountSilent=true;try{runs=Array.isArray(next)?next:[];S.set('runs',runs);renderAll()}finally{accountSilent=false}},
 readSettings(){return{race:S.get('race',null),goal:S.get('goal',null),checks:S.get('checks',{})||{},coachUrl:S.get('coachUrl','')||'',planBlurb:S.get('blurb','')||''}},
 applySettings(s){if(!s)return;accountSilent=true;try{
  if('race' in s){if(s.race)S.set('race',s.race);else localStorage.removeItem('ra_race')}
  if('goal' in s){if(s.goal)S.set('goal',s.goal);else localStorage.removeItem('ra_goal')}
  if('checks' in s)S.set('checks',s.checks||{});
  if('coachUrl' in s){if(s.coachUrl)S.set('coachUrl',s.coachUrl);else localStorage.removeItem('ra_coachUrl')}
  if('planBlurb' in s){if(s.planBlurb)S.set('blurb',s.planBlurb);else localStorage.removeItem('ra_blurb');const el=$('#meBlurb');if(el&&document.activeElement!==el)el.value=s.planBlurb||''}
  renderAll();
 }finally{accountSilent=false}},
 clearLocal(){accountSilent=true;try{goalProfile=null;['runs','race','goal','checks','coachUrl','blurb','goal_profile'].forEach(k=>localStorage.removeItem('ra_'+k));runs=[];chat=[];document.body.classList.remove('picking');renderAll()}finally{accountSilent=false}},
 applyGoalProfile,goalProfile(){return goalProfile},goalName,
 snapshotLocal(){return{runs:S.get('runs',[])||[],race:S.get('race',null),goal:S.get('goal',null),checks:S.get('checks',{})||{},planBlurb:S.get('blurb','')||''}},
 S,$,fmtP,fmtT,DN,today,daysAgo,weeklyKm};
