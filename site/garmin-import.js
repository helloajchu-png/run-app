// Garmin Connect import (client-side, no deps): Activities.csv, GPX, FIT.
// Usage: const runs = await GarminImport.parseFiles(fileList);
//        const merged = GarminImport.mergeRuns(existing, runs);
// Run shape: {date:'YYYY-MM-DD', start:ISO, distanceKm, durationSec, avgHr, source}
(function(g){
const R=6371.0088, rad=d=>d*Math.PI/180;
function hav(a,b){const dl=rad(b.lat-a.lat),dn=rad(b.lon-a.lon);const h=Math.sin(dl/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function localDate(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;}
function mk(start,km,sec,hr,src){const d=new Date(start);return {date:localDate(d),start:d.toISOString(),distanceKm:+km.toFixed(3),durationSec:Math.round(sec),avgHr:hr?Math.round(hr):null,source:src};}

// ---- CSV ----
function csvRows(t){const rows=[];let row=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];
 if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++;}else q=false;}else f+=c;}
 else if(c=='"')q=true;else if(c==','){row.push(f);f='';}else if(c=='\n'||c=='\r'){if(c=='\r'&&t[i+1]=='\n')i++;row.push(f);rows.push(row);row=[];f='';}else f+=c;}
 if(f||row.length){row.push(f);rows.push(row);}return rows.filter(r=>r.some(x=>x.trim()));}
function hms(s){if(!s)return 0;const p=s.split(':').map(Number);return p.reduce((a,b)=>a*60+b,0);}
function num(s){return s==null||s===''||s==='--'?NaN:parseFloat(String(s).replace(/,/g,''));}
function parseCSV(text){const rows=csvRows(text.replace(/^\uFEFF/,''));if(!rows.length)return[];
 const H=rows[0].map(h=>h.trim().toLowerCase());const ix=n=>H.findIndex(h=>n.some(x=>h===x));
 const iT=ix(['activity type']),iD=ix(['date']),iDist=ix(['distance']),iTime=ix(['time','elapsed time','moving time']),iHr=ix(['avg hr','average heart rate']);
 // Garmin exports distance in the account's unit; assume km unless header/units say mi
 const miles=/mi/.test(H[iDist]||'')||rows.slice(1).some(r=>/mi\b/i.test(r[iDist]||''));
 const out=[];for(const r of rows.slice(1)){const type=(r[iT]||'').toLowerCase();if(iT>=0&&!/run/.test(type))continue;
  let km=num(r[iDist]);if(!(km>0))continue;if(miles)km*=1.609344;
  const start=new Date((r[iD]||'').replace(' ','T'));if(isNaN(start))continue;
  out.push(mk(start,km,hms(r[iTime]),num(r[iHr])||null,'garmin-csv'));}
 return out;}

// ---- GPX ----
function parseGPX(text){const doc=new DOMParser().parseFromString(text,'application/xml');
 const pts=[...doc.getElementsByTagName('trkpt')].map(p=>{const t=p.getElementsByTagName('time')[0];const hr=[...p.getElementsByTagName('*')].find(e=>/(^|:)hr$/.test(e.tagName));
  return{lat:+p.getAttribute('lat'),lon:+p.getAttribute('lon'),t:t?new Date(t.textContent):null,hr:hr?+hr.textContent:null};});
 if(pts.length<2)return[];let km=0;for(let i=1;i<pts.length;i++)km+=hav(pts[i-1],pts[i]);
 const ts=pts.filter(p=>p.t);const hrs=pts.map(p=>p.hr).filter(Boolean);
 const start=ts[0]?ts[0].t:new Date();const sec=ts.length>1?(ts[ts.length-1].t-ts[0].t)/1000:0;
 return[mk(start,km,sec,hrs.length?hrs.reduce((a,b)=>a+b)/hrs.length:null,'garmin-gpx')];}

// ---- FIT (minimal: session msgs, global 18) ----
const FIT_EPOCH=631065600; // 1989-12-31T00:00:00Z
function parseFIT(buf){const v=new DataView(buf);const hs=v.getUint8(0);
 if(String.fromCharCode(...new Uint8Array(buf,8,4))!=='.FIT')throw new Error('Not a FIT file');
 const end=hs+v.getUint32(4,true);let o=hs;const defs={};const sessions=[];let lastTs=0;
 while(o<end&&o<buf.byteLength){const h=v.getUint8(o++);
  if(h&0x80){// compressed timestamp header -> data msg
   const lt=(h>>5)&3;o=readData(defs[lt],o);continue;}
  const lt=h&0x0F;
  if(h&0x40){// definition
   const dev=h&0x20;o++;const le=v.getUint8(o++)===0;const gm=v.getUint16(o,le);o+=2;const n=v.getUint8(o++);const fields=[];
   for(let i=0;i<n;i++){fields.push({num:v.getUint8(o),size:v.getUint8(o+1),type:v.getUint8(o+2)&0x1F});o+=3;}
   let devSize=0;if(dev){const nd=v.getUint8(o++);for(let i=0;i<nd;i++){devSize+=v.getUint8(o+1);o+=3;}}
   defs[lt]={le,gm,fields,devSize};}
  else o=readData(defs[lt],o);}
 function rd(off,f,le){const s=f.size;
  if(s===1)return v.getUint8(off);if(s===2)return v.getUint16(off,le);if(s===4)return v.getUint32(off,le);return null;}
 function readData(d,off){if(!d)throw new Error('Bad FIT: undefined local message');const m={};
  for(const f of d.fields){m[f.num]=rd(off,f,d.le);off+=f.size;}off+=d.devSize;
  if(d.gm===18)sessions.push(m);return off;}
 const inv=x=>x==null||x===0xFFFFFFFF||x===0xFFFF||x===0xFF;
 return sessions.filter(s=>inv(s[5])||s[5]===1).map(s=>{ // sport 1 = running
  const start=new Date((s[2]+FIT_EPOCH)*1000);
  const km=inv(s[9])?0:s[9]/100/1000;const sec=!inv(s[8])?s[8]/1000:(!inv(s[7])?s[7]/1000:0);
  return mk(start,km,sec,inv(s[16])?null:s[16],'garmin-fit');}).filter(r=>r.distanceKm>0);}

async function parseFiles(files){const out=[],errors=[];
 for(const f of files){const n=f.name.toLowerCase();try{
  if(n.endsWith('.fit'))out.push(...parseFIT(await f.arrayBuffer()));
  else if(n.endsWith('.gpx'))out.push(...parseGPX(await f.text()));
  else if(n.endsWith('.csv'))out.push(...parseCSV(await f.text()));
  else errors.push(`${f.name}: unsupported type`);}catch(e){errors.push(`${f.name}: ${e.message}`);}}
 out.errors=errors;return out;}

// Dedupe by date + distance (rounded to 0.05 km tolerance)
const key=r=>`${r.date}|${Math.round(r.distanceKm*20)}`;
function mergeRuns(existing,incoming){const seen=new Set(existing.map(key));const added=[];
 for(const r of incoming){const k=key(r);if(seen.has(k))continue;seen.add(k);added.push(r);}
 return{runs:existing.concat(added).sort((a,b)=>a.date<b.date?-1:1),added:added.length,skipped:incoming.length-added.length};}

g.GarminImport={parseFiles,parseCSV,parseGPX,parseFIT,mergeRuns};
})(typeof window!=='undefined'?window:globalThis);
