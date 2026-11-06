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
 const i=runs.findIndex(x=>x.id===r.id);if(i>=0){r.source=runs[i].source;runs[i]=r}else runs.push(r);resetForm();save()};
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
 const V=b.v;$('#predict').innerHTML=`<p>依據：<b>${esc(b.label)}</b><br>VDOT 估計：<b>${V.toFixed(1)}</b></p><table><tr><th>距離</th><th>Riegel 預測</th><th>VDOT 預測</th><th>配速</th></tr>${[5,10,21.0975,42.195].map(d=>{const t=riegel(b.sec,b.km,d);return`<tr><td>${DN[d]}</td><td>${fmtT(t)}</td><td>${fmtT(vdotTime(V,d))}</td><td>${fmtP(t/d)}</td></tr>`}).join('')}</table>
 <h2 style="margin-top:12px">訓練配速（VDOT）</h2><table><tr><td>輕鬆跑 E</td><td>${fmtP(paceAt(V,.74))} ～ ${fmtP(paceAt(V,.65))}</td></tr><tr><td>馬拉松配速 M</td><td>${fmtP(vdotTime(V,42.195)/42.195)}</td></tr><tr><td>閾值 T</td><td>${fmtP(paceAt(V,.88))}</td></tr><tr><td>間歇 I</td><td>${fmtP(paceAt(V,.975))}</td></tr></table>`}
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
function renderPlan(){const g=S.get('goal',null);if(!g){$('#gDate').value='';return}
 $('#gDist').value=String(g.dist);$('#gDate').value=g.date;$('#gTime').value=fmtT(g.sec);$('#gDays').value=g.days;
 const p=genPlan(g);const pred=vdotTime(p.V,g.dist);const gap=pred-g.sec;
 $('#planOut').innerHTML=`<div class="card"><p>距離比賽 <b>${p.weeks}</b> 週。目前預測 ${fmtT(pred)}（VDOT ${p.V.toFixed(1)}），目標需 VDOT ${p.gV.toFixed(1)}。${gap>0?`<br>還差約 ${fmtT(gap)}，${p.gV-p.V>3?'目標偏積極，建議穩定累積里程。':'持續訓練有機會達成！'}`:'<br>目前體能已達目標，維持即可。'}</p>
 <table><tr><td>輕鬆 / 長跑</td><td>${fmtP(p.P.E)}</td></tr><tr><td>目標配速</td><td>${fmtP(p.P.G)}</td></tr><tr><td>節奏 T</td><td>${fmtP(p.P.T)}</td></tr><tr><td>間歇 I</td><td>${fmtP(p.P.I)}</td></tr></table></div>`+
 p.out.map(w=>`<div class="card wk"><h3>第 ${w.w} 週・${w.phase}・約 ${w.km} km</h3>${w.days.map(d=>`<div>${d[0]}　<span class="tag ${TAG[d[1]][1]}">${TAG[d[1]][0]}</span> ${esc(d[2])}　<span class="muted">${fmtP(d[3])}</span></div>`).join('')}<div class="muted">其餘日休息或交叉訓練</div></div>`).join('')}
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
async function askCoach(e){
 e.preventDefault();
 const btn=$('#chatSend'),box=$('#chatMsg'),err=$('#chatErr');
 if(!btn||btn.disabled)return;
 const message=box.value.trim();
 if(!message){err.textContent='先寫下想問教練的問題';return}
 btn.disabled=true;btn.textContent='送出中…';err.textContent='';
 chat.push({role:'user',text:message});
 const pending={role:'coach',text:'思考中…'};chat.push(pending);
 box.value='';renderChat();
 const last=$('#chatLog').lastElementChild;if(last)last.scrollIntoView({block:'nearest'});
 const base=coachEndpoint();
 let context='{}';
 try{context=coachContext()}catch(err2){context=JSON.stringify({note:'上下文整理失敗',detail:String(err2)})}
 try{
  const r=await fetch(base+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,context})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||typeof j.reply!=='string')throw new Error(j.error||j.message||('HTTP '+r.status));
  pending.text=j.reply||'（沒有回覆）';
 }catch(ex){
  if(chat[chat.length-1]===pending)chat.pop();
  if(chat[chat.length-1]&&chat[chat.length-1].role==='user')chat.pop();
  box.value=message;err.textContent='送出失敗：'+ex.message;
 }
 btn.disabled=false;btn.textContent='送出';renderChat();
}
$('#coachForm').addEventListener('submit',askCoach);
$('#saveCoachUrl').onclick=()=>{const v=$('#coachUrl').value.trim();if(v)S.set('coachUrl',v);else localStorage.removeItem('ra_coachUrl');alert(v?'已改用自訂網址':'已恢復預設教練')};
function renderCoach(){$('#tips').innerHTML=coachTips().map(t=>`<div class="tip ${t.c}">${esc(t.t)}</div>`).join('');
 const urlEl=$('#coachUrl');if(urlEl&&document.activeElement!==urlEl)urlEl.value=S.get('coachUrl','')||'';renderChat()}
$('#exportBtn').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({runs,race:S.get('race'),goal:S.get('goal')},null,1)],{type:'application/json'}));a.download='runs.json';a.click()};
$('#clearBtn').onclick=()=>{if(confirm('清除所有資料？')){['runs','race','goal'].forEach(k=>localStorage.removeItem('ra_'+k));runs=[];renderAll()}};

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
function renderAll(){renderLog();renderFit();renderPlan();renderCoach();renderHero()}
renderAll();updPace();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
