'use strict';
// ============================================================
// 한국지리 백지도 정복 — 게임 엔진 (Firebase Auth 통합판)
// ============================================================
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, increment, collection, query, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// Firestore 덮어쓰기 가능한 let 변수
let MCQ = window.MCQ || [];
let OX  = window.OX  || [];
// LOCATIONS / FREQ / REGION_NOTES 는 window.* 로 참조 중이므로 그대로 두되
// window.LOCATIONS 재할당으로 교체됨 (locPool 캐시 초기화 필요)

const $ = id => document.getElementById(id);
const REGIONS = ['전체','북한','수도권','강원','충청','호남','영남','제주'];
const MAP_REGIONS = ['수도권','강원','충청','호남','영남','제주'];

const store = {
  load(key,def){ try{return JSON.parse(localStorage.getItem(key))??def;}catch(e){return def;} },
  save(key,v){ try{localStorage.setItem(key,JSON.stringify(v));}catch(e){} },
  remove(key){ try{localStorage.removeItem(key);}catch(e){} }
};


// ============================================================
// [engine.js 삽입용] Firestore 게임 데이터 로더
// 위치: onAuthStateChanged 콜백 내부, buildMap() 호출 전
// ============================================================

// 게임 데이터를 Firestore에서 읽어 로컬 변수에 덮어씌웁니다.
// 실패 시 로컬 js 파일(questions.js 등)의 값을 그대로 사용합니다.
async function loadGameData() {
  const overlay = document.getElementById('loading-overlay');
  const loadMsg = document.getElementById('loading-msg');
  const loadBar = document.getElementById('loading-bar');

  const progress = (pct, msg) => {
    if (loadBar) loadBar.style.width = pct + '%';
    if (loadMsg) loadMsg.textContent = msg;
  };

  try {
    // ── MCQ ──────────────────────────────────────────────────
    progress(10, '개념 퀴즈 불러오는 중...');
    const mcqSnap = await getDocs(collection(db, 'gameData/mcq/items'));
    if (!mcqSnap.empty) {
      const arr = [];
      mcqSnap.forEach(d => {
        const v = d.data();
        arr.push({
          region: v.region || '',
          q: v.q || '',
          choices: Array.isArray(v.choices) ? v.choices : [],
          answer: typeof v.answer === 'number' ? v.answer : 0,
          exp: v.exp || ''
        });
      });
      if (arr.length) MCQ = arr;   // ← engine.js 스코프 let 변수 재할당
    }

    // ── OX ───────────────────────────────────────────────────
    progress(28, 'OX 문제 불러오는 중...');
    const oxSnap = await getDocs(collection(db, 'gameData/ox/items'));
    if (!oxSnap.empty) {
      const arr = [];
      oxSnap.forEach(d => {
        const v = d.data();
        arr.push({ region: v.region || '', q: v.q || '', answer: !!v.answer, exp: v.exp || '' });
      });
      if (arr.length) OX = arr;
    }

    // ── LOCATIONS ────────────────────────────────────────────
    progress(46, '위치 데이터 불러오는 중...');
    const locSnap = await getDocs(collection(db, 'gameData/locations/items'));
    if (!locSnap.empty) {
      const arr = [];
      locSnap.forEach(d => {
        const v = d.data();
        arr.push({
          name: v.name || '',
          x: parseFloat(v.x) || 0,
          y: parseFloat(v.y) || 0,
          region: v.region || '',
          fact: v.fact || '',
          accept: Array.isArray(v.accept) ? v.accept : []
        });
      });
      if (arr.length) {
        // LOCATIONS는 window.LOCATIONS(map-data.js)를 재정의
        window.LOCATIONS = arr;
        LOC_POOL = null; // locPool() 캐시 초기화
      }
    }

    // ── FREQ ─────────────────────────────────────────────────
    progress(68, '빈출 분석 불러오는 중...');
    const freqDocSnap = await getDoc(doc(db, 'gameData/freq/data'));
    if (freqDocSnap.exists()) {
      try {
        const parsed = JSON.parse(freqDocSnap.data().json || '{}');
        if (Object.keys(parsed).length) window.FREQ = parsed;
      } catch (e) {}
    }

    // ── REGION_NOTES ─────────────────────────────────────────
    progress(84, '지역 메모 불러오는 중...');
    const notesSnap = await getDoc(doc(db, 'gameData/regionNotes/data'));
    if (notesSnap.exists()) {
      try {
        const parsed = JSON.parse(notesSnap.data().json || '{}');
        if (Object.keys(parsed).length) window.REGION_NOTES = parsed;
      } catch (e) {}
    }

    progress(100, '준비 완료!');

  } catch (err) {
    console.warn('[Firestore 로딩 실패 — 로컬 데이터 사용]', err);
    progress(100, '로컬 데이터로 시작합니다.');
  }

  setTimeout(() => { if (overlay) overlay.style.display = 'none'; }, 350);
}





let stats=store.load('geo_stats',{}), xp=store.load('geo_xp',0), board=store.load('geo_board',{});
let wanted=store.load('geo_wanted',{}), titles=store.load('geo_titles',{});
let coins=store.load('geo_coins',0), cards=store.load('geo_cards',{});
let cardLv=store.load('geo_cardlv',{}), ach=store.load('geo_ach',{});
let mission=store.load('geo_mission',null);

let currentUser=null;
onAuthStateChanged(auth, async (user)=>{
  if(!user){window.location.href='index.html';return;}
  currentUser=user;
  const emailId=user.email.split('@')[0];
  const chip=$('account-chip');
  if(chip){
    chip.textContent=`👤 ${emailId}`;
    chip.onclick=()=>{ if(confirm(`${emailId} 로그아웃?`)) signOut(auth).then(()=>window.location.href='index.html'); };
  }
  const userRef=doc(db,'users',user.uid);
  const snap=await getDoc(userRef);
  if(!snap.exists()) await setDoc(userRef,{email:user.email,totalScore:0,playCount:0,createdAt:serverTimestamp()});

  // ★ Firestore에서 게임 데이터 로딩 (로컬 fallback 포함)
  await loadGameData();

  buildMap(); initMapGestures(); initHome();
  show('screen-home');
});

async function saveScoreToFirestore(s){
  if(!currentUser||!s) return;
  try{const r=doc(db,'users',currentUser.uid);await updateDoc(r,{totalScore:increment(s),playCount:increment(1)});}catch(e){}
}
async function fetchFirestoreBoard(){
  try{
    const q=query(collection(db,'users'),orderBy('totalScore','desc'),limit(10));
    const snap=await getDocs(q);
    return snap.docs.map(d=>({name:d.data().email?.split('@')[0]||'익명',score:d.data().totalScore||0}));
  }catch(e){return [];}
}

const RANKS=[[0,'🌱 지리 새내기'],[300,'🧭 길눈 밝은 학생'],[800,'🚌 답사 견습생'],
  [1600,'🗺️ 지도 읽는 자'],[2800,'⛰️ 대간 종주자'],[4500,'🚄 국토 순례자'],
  [7000,'🏞️ 지역 전문가'],[10000,'🌏 백지도 마스터'],[15000,'👑 한국지리 그랜드마스터']];

const G={mode:null,region:'전체',queue:[],idx:0,score:0,combo:0,maxCombo:0,correctCnt:0,
  timer:null,timeLeft:0,timeMax:0,oxEnd:0,battle:null,locked:false,bossRegion:null,
  noTimer:false,lastCorrect:true,curType:null,bingo:null};

const MODE_INFO={
  explore:{title:'🔍 백지도 탐색',useMap:true},
  location:{title:'📍 위치 사냥',useMap:true,n:14,time:30},
  muniname:{title:'🔎 지역 판독',useMap:true,n:12,time:25},
  detective:{title:'🕵️ 지역 추리',useMap:true,n:10,time:55},
  climate:{title:'🌡️ 기후 비교',useMap:true,n:8,time:40},
  stats:{title:'📊 통계 비교',useMap:true,n:8,time:40},
  mcq:{title:'📝 개념 퀴즈',useMap:false,n:10,time:35},
  ox:{title:'⚡ 스피드 OX',useMap:false,time:60},
  battle:{title:'⚔️ 1:1 배틀',useMap:true,n:16,time:30},
  theme:{title:'🏷️ 테마 게임',useMap:true,n:12,time:30},
  wanted:{title:'🔍 오답 수배',useMap:true,n:12,time:30},
  boss:{title:'👹 권역 보스전',useMap:true,n:10,time:30},
  bingo:{title:'🧩 빙고 게임',useMap:false,n:25,time:22},
  streak:{title:'🔥 연승 모드',useMap:true,time:0},
  daily:{title:'🔁 오늘의 도전',useMap:true,n:10,time:26},
};
const MODE_COLOR={location:'#1278C2',muniname:'#2FA34F',detective:'#6A5ACD',climate:'#E8740C',
  stats:'#1B4F8F',mcq:'#0F9D8C',ox:'#0FA958',battle:'#E2574C',wanted:'#C2410C',
  boss:'#B5342A',theme:'#D6336C',bingo:'#8A4FBE',streak:'#E8590C',daily:'#0CA678'};
const WARMUP_MODES=new Set(['location','muniname','detective','climate','stats','battle','wanted','theme']);
const BOSS_REGIONS=['수도권','강원','충청','호남','영남','제주'];
const BOSS_GATE=0.6, BOSS_MIN_T=5;
function bossMastery(r){const s=stats[r];return s&&s.t?s.c/s.t:0;}
function bossUnlocked(r){const s=stats[r];return!!s&&s.t>=BOSS_MIN_T&&s.c/s.t>=BOSS_GATE;}
function bossTitle(r){return `${regionLabel(r)} 정복자`;}

// ============================================================
// 테마 빌더 (원본 buildThemes 동일)
// ============================================================
let THEMES_CACHE=null;
function buildThemes(){
  if(THEMES_CACHE) return THEMES_CACHE;
  const provTop={};
  Object.entries(window.MUNIS||{}).forEach(([n,m])=>{
    if(!m.pop||!m.prov||/특별시|광역시|특별자치시/.test(m.prov)) return;
    if(!provTop[m.prov]||(MUNIS[provTop[m.prov]].pop||0)<m.pop) provTop[m.prov]=n;
  });
  const pop1=Object.entries(provTop).map(([prov,n])=>({a:n,c:`${prov}에서 인구가 가장 많은 시·군`}));
  THEMES_CACHE=[
    {key:'docheong',label:'🏛️ 도청 소재지',items:[
      {a:'수원시',c:'경기도의 도청 소재지'},{a:'춘천시',c:'강원특별자치도의 도청 소재지'},
      {a:'청주시',c:'충청북도의 도청 소재지'},{a:'홍성군',c:'충청남도의 도청 소재지(내포 신도시)'},
      {a:'전주시',c:'전북특별자치도의 도청 소재지'},{a:'무안군',c:'전라남도의 도청 소재지(남악 신도시)'},
      {a:'안동시',c:'경상북도의 도청 소재지'},{a:'창원시',c:'경상남도의 도청 소재지'},{a:'제주시',c:'제주특별자치도의 도청 소재지'},
    ]},
    {key:'innov',label:'🏢 혁신도시·기업도시',items:[
      {a:'나주시',c:'광주·전남 공동 혁신도시(빛가람동, 한국전력 등)'},{a:'김천시',c:'경북 혁신도시(한국도로공사 등)'},
      {a:'진주시',c:'경남 혁신도시(LH 한국토지주택공사)'},{a:'원주시',c:'강원 혁신도시(건강보험공단)이자 기업도시'},
      {a:'음성군',c:'충북 혁신도시(진천·음성)'},{a:'서귀포시',c:'제주 혁신도시'},
      {a:'완주군',c:'전북 혁신도시(전주·완주)'},{a:'태안군',c:'관광 레저형 기업도시'},{a:'충주시',c:'지식 기반형 기업도시'},
    ]},
    {key:'festival',label:'🎉 축제',items:[
      {a:'보령시',c:'대천 해수욕장의 머드 축제'},{a:'진주시',c:'남강 유등 축제'},
      {a:'함평군',c:'나비 축제'},{a:'김제시',c:'지평선 축제(드넓은 평야)'},
      {a:'화천군',c:'산천어 축제(겨울)'},{a:'안동시',c:'국제 탈춤 페스티벌'},
      {a:'강릉시',c:'단오제(유네스코 인류무형유산)'},{a:'보성군',c:'다향 대축제(녹차밭)'},
      {a:'무주군',c:'반딧불 축제(청정 자연)'},{a:'광양시',c:'매화 축제'},
      {a:'금산군',c:'인삼 축제'},{a:'이천시',c:'도자기 축제'},{a:'영동군',c:'포도 축제'},
    ]},
    {key:'traffic',label:'✈️ 교통(공항·KTX)',items:[
      {a:'인천광역시',c:'영종도 간척지에 세운 우리나라 최대 관문 국제공항이 있는, 수도권 서해안의 항구 도시'},
      {a:'서울특별시',c:'우리나라 수도이자, 강서구에 국내선 중심 김포 국제공항이 있는 도시'},
      {a:'부산광역시',c:'경부 고속철도(KTX)의 종착역과 김해 국제공항을 끼고 있는, 우리나라 제2의 도시이자 최대 무역항'},
      {a:'제주시',c:'우리나라 최대 관광 섬의 북부 관문 국제공항이 있는, 도(道)의 중심 도시'},
      {a:'대구광역시',c:'동대구역(경부 KTX)이 있는, 영남 내륙의 최대 분지 도시'},
      {a:'청주시',c:'충북 도청 소재지로, 경부·호남 고속철도가 갈라지는 오송역과 국제공항이 있는 도시'},
      {a:'광주광역시',c:'호남 고속철도가 지나는 송정역이 있는, 호남 최대 도시'},
      {a:'강릉시',c:'2018 평창 동계올림픽 빙상 경기가 열린, 경강선 KTX가 닿는 강원 동해안 도시'},
    ]},
    {key:'pop1',label:'👥 인구 1위 지역(도별)',items:pop1},
    {key:'special',label:'🍊 특산물',items:[
      {a:'횡성군',c:'한우(축산물 지리적 표시제 1호)'},{a:'보성군',c:'녹차(드넓은 차밭)'},
      {a:'영광군',c:'법성포 굴비'},{a:'영덕군',c:'대게'},{a:'상주시',c:'곶감(감 주산지)'},
      {a:'나주시',c:'배'},{a:'의성군',c:'마늘'},{a:'성주군',c:'참외'},{a:'금산군',c:'인삼'},
      {a:'서귀포시',c:'감귤(따뜻한 기후)'},{a:'통영시',c:'굴(남해안 양식)'},{a:'고창군',c:'복분자'},
    ]},
    {key:'heritage',label:'🏯 유네스코 세계유산',items:[
      {a:'경주시',c:'불국사·석굴암, 경주 역사유적지구'},{a:'합천군',c:'해인사 장경판전(팔만대장경)'},
      {a:'서울특별시',c:'종묘·창덕궁·조선 왕릉'},{a:'수원시',c:'수원 화성'},
      {a:'안동시',c:'하회마을(한국의 역사마을), 도산서원'},{a:'공주시',c:'백제 역사유적지구(공산성)'},
      {a:'부여군',c:'백제 역사유적지구(부소산성·정림사지)'},{a:'익산시',c:'백제 역사유적지구(미륵사지)'},
      {a:'고창군',c:'고인돌 유적, 한국의 갯벌'},{a:'양산시',c:'통도사(한국의 산지승원)'},
      {a:'영주시',c:'부석사, 소수서원'},{a:'보은군',c:'법주사(속리산)'},{a:'순천시',c:'선암사, 순천만 갯벌'},
    ]},
  ];
  THEMES_CACHE.forEach(t=>{t.items=t.items.filter(it=>MUNIS[it.a]);});
  return THEMES_CACHE;
}
function themeByKey(k){return buildThemes().find(t=>t.key===k);}

// ============================================================
// locPool
// ============================================================
let LOC_POOL=null;
function locPool(){
  if(LOC_POOL) return LOC_POOL;
  const mascotAssets=(typeof MASCOT_ASSETS!=='undefined'?MASCOT_ASSETS:[]).filter(a=>a.accept&&a.accept[0]&&MUNIS[a.accept[0]]);
  const mascotImageByMuni=new Map(mascotAssets.map(a=>[a.accept[0],a.image]));
  const curatedMascots=typeof MASCOTS!=='undefined'?new Set(MASCOTS.map(m=>m.accept[0])):new Set();
  const factByMuni=new Map();
  LOCATIONS.forEach(l=>l.accept.forEach(a=>{if(l.fact&&!factByMuni.has(a))factByMuni.set(a,l.fact);}));
  let mascotLocs=[];
  if(typeof MASCOTS!=='undefined'){
    mascotLocs=MASCOTS.map(m=>{
      const mu=MUNIS[m.accept[0]],label=m.accept[0].replace(/\(.+\)$/,'');
      return {name:label,x:mu.cx,y:mu.cy,region:m.region,accept:m.accept,
              image:mascotImageByMuni.get(m.accept[0])||null,mascotName:m.name,
              fact:`마스코트 '${m.name}'의 고장 — ${m.desc}`,descOnly:true,desc:m.desc};
    });
  }
  const imageMascotLocs=mascotAssets.filter(a=>!curatedMascots.has(a.accept[0])).map(a=>{
    const mu=MUNIS[a.accept[0]],label=a.accept[0].replace(/\(.+\)$/,'');
    const rd=factByMuni.get(a.accept[0])||noteOf(label)||`${(MUNIS[a.accept[0]]||{}).prov||''}에 위치한 시·군`;
    return {name:label,x:mu.cx,y:mu.cy,region:mu.region,accept:a.accept,
            image:a.image,descOnly:true,imageOnly:true,mascotName:null,fact:`${label} — ${rd}`,desc:rd};
  });
  LOC_POOL=LOCATIONS.concat(mascotLocs,imageMascotLocs);
  return LOC_POOL;
}

// ============================================================
// 유틸
// ============================================================
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');try{window.scrollTo(0,0);}catch(e){}}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function regionLabel(r){return(r==='수도권'||!MAP_REGIONS.includes(r))?r:r+'권';}
function escapeAttr(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function imgSearchLink(kw,ex){const q=encodeURIComponent(kw+' '+(ex||'지리'));return `<a class="img-link" href="https://search.naver.com/search.naver?where=image&query=${q}" target="_blank" rel="noopener">📷 ${kw} 이미지 자료</a>`;}
function freqOf(n){const f=FREQ[n]||FREQ[n+'시']||FREQ[n+'군'];return f?f.count:0;}
function freqInfo(n){return FREQ[n]||FREQ[n+'시']||FREQ[n+'군']||null;}
function noteOf(n){return REGION_NOTES[n]||REGION_NOTES[n+'시']||REGION_NOTES[n+'군']||null;}
function muniShort(m){const l=LOCATIONS.find(x=>x.accept.includes(m));return(l&&l.name)||m.replace(/(특별자치시|특별자치도|광역시|특별시|자치시|자치도|시|군)$/,'');}
function fmtPop(p){if(!p)return'';if(p>=1e6)return(p/1e4).toFixed(0)+'만';if(p>=1e5)return Math.round(p/1e4)+'만';return(p/1e4).toFixed(1)+'만';}
function maskName(text,loc){
  let t=text;
  [loc.name,...loc.accept].forEach(n=>{const base=n.replace(/\(.+\)$/,''),stem=base.replace(/[시군구]$/,'');[base,stem].forEach(s=>{if(s&&s.length>=2)t=t.split(s).join('◯◯');});});
  return t;
}
function splitFact(f){
  const parts=[];let cur='',depth=0;
  for(let i=0;i<(f||'').length;i++){const ch=f[i];
    if(ch==='('||ch==='（')depth++;if(ch===')'||ch==='）')depth=Math.max(0,depth-1);
    const numCtx=/\d/.test(f[i-1]||'')&&/\d/.test(f[i+1]||'');
    if((ch===','||ch==='.')&&depth===0&&!numCtx){parts.push(cur);cur='';}else cur+=ch;
  }
  parts.push(cur);return parts.map(s=>s.trim()).filter(s=>s.length>=2);
}
function studyExtra(name){
  const f=freqInfo(name),n=noteOf(name);let h='';
  if(f)h+=`<div class="fb-extra">🔥 최근 5개년 기출 <b>${f.count}회</b> 언급 (${f.exams}개 시험)</div>`;
  if(n)h+=`<div class="fb-extra">📌 ${n}</div>`;
  h+=`<div class="fb-extra">${imgSearchLink(name)}</div>`;return h;
}
function dayKey(d){d=d||new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function seededRnd(str){let s=hashStr(str)||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}

function weightedSample(items,n,keyFn){
  const pool=items.slice(),out=[];
  while(out.length<n&&pool.length){
    const ws=pool.map(it=>1+Math.min(freqOf(keyFn(it)),18)/9);
    let r=Math.random()*ws.reduce((a,b)=>a+b,0),i=0;
    for(;i<pool.length-1;i++){r-=ws[i];if(r<=0)break;}
    out.push(pool.splice(i,1)[0]);
  }
  return out;
}
function sampleLocQueue(items,n){
  const recent=new Set(store.load('geo_recent_locs',[]));
  const used=new Set(),out=[];
  while(out.length<n){
    const avail=items.filter(it=>!used.has(it.accept[0]));if(!avail.length)break;
    const ws=avail.map(it=>{let w=1+Math.min(freqOf(it.accept[0]),18)/9;if(recent.has(it.accept[0]))w*=0.12;return w;});
    let r=Math.random()*ws.reduce((a,b)=>a+b,0),i=0;
    for(;i<avail.length-1;i++){r-=ws[i];if(r<=0)break;}
    used.add(avail[i].accept[0]);out.push(avail[i]);
  }
  const hist=store.load('geo_recent_locs',[]).concat([...used]);
  store.save('geo_recent_locs',hist.slice(-45));return out;
}


// ============================================================
// 지도 렌더링
// ============================================================
const VIEW0={x:-8,y:-8,w:776,h:822};
let view={...VIEW0},svgBuilt=false,viewAnimId=null;

function buildMap(){
  if(svgBuilt)return;
  const svg=$('map-svg');if(!svg||!window.MUNIS||!window.PROVINCES)return;
  svg.innerHTML='';applyView();
  for(const[name,m]of Object.entries(MUNIS)){
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',m.d);path.setAttribute('class','muni');
    path.dataset.name=name;path.dataset.prov=m.prov;path.dataset.region=m.region;
    svg.appendChild(path);
  }
  for(const[,p]of Object.entries(PROVINCES)){
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',p.d);path.setAttribute('class','prov-border');svg.appendChild(path);
  }
  svgBuilt=true;
}
function applyView(){const svg=$('map-svg');if(svg)svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);}
function animateView(tv){
  if(viewAnimId){cancelAnimationFrame(viewAnimId);viewAnimId=null;}
  const from={...view},t0=performance.now();
  const step=t=>{const k=Math.min(1,(t-t0)/240),e=1-Math.pow(1-k,3);
    view={x:from.x+(tv.x-from.x)*e,y:from.y+(tv.y-from.y)*e,w:from.w+(tv.w-from.w)*e,h:from.h+(tv.h-from.h)*e};
    applyView();if(k<1)viewAnimId=requestAnimationFrame(step);else viewAnimId=null;};
  viewAnimId=requestAnimationFrame(step);
}
function clampView(){
  view.x=Math.max(VIEW0.x-60,Math.min(view.x,VIEW0.x+VIEW0.w-view.w+60));
  view.y=Math.max(VIEW0.y-60,Math.min(view.y,VIEW0.y+VIEW0.h-view.h+60));
}
function clampedTarget(tv){const old={...view};view=tv;clampView();const r={...view};view=old;return r;}
function resetView(){animateView({...VIEW0});}
function zoomAt(cx,cy,factor){const nw=Math.min(VIEW0.w,Math.max(VIEW0.w/8,view.w*factor)),k=nw/view.w;animateView(clampedTarget({x:cx-(cx-view.x)*k,y:cy-(cy-view.y)*k,w:nw,h:view.h*k}));}
function svgPoint(clientX,clientY){const svg=$('map-svg'),pt=svg.createSVGPoint();pt.x=clientX;pt.y=clientY;return pt.matrixTransform(svg.getScreenCTM().inverse());}

let suppressTap=false;
function initMapGestures(){
  const svg=$('map-svg');if(!svg)return;
  const ptrs=new Map();let panStart=null,pinch0=null,moved=false;
  svg.addEventListener('pointerdown',e=>{
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===1){panStart={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y};moved=false;}
    else if(ptrs.size===2){
      if(viewAnimId){cancelAnimationFrame(viewAnimId);viewAnimId=null;}
      const[a,b]=[...ptrs.values()];const rect=svg.getBoundingClientRect();
      const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
      pinch0={d:Math.hypot(a.x-b.x,a.y-b.y),v:{...view},ax:view.x+(mx-rect.left)/rect.width*view.w,ay:view.y+(my-rect.top)/rect.height*view.h};
      panStart=null;
    }
  });
  svg.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId))return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const rect=svg.getBoundingClientRect();
    if(ptrs.size===2&&pinch0){
      const[a,b]=[...ptrs.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(Math.abs(d-pinch0.d)>6){moved=true;suppressTap=true;}
      if(moved){const nw=Math.min(VIEW0.w,Math.max(VIEW0.w/8,pinch0.v.w*(pinch0.d/d))),nh=pinch0.v.h*(nw/pinch0.v.w);
        const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
        view={x:pinch0.ax-(mx-rect.left)/rect.width*nw,y:pinch0.ay-(my-rect.top)/rect.height*nh,w:nw,h:nh};
        clampView();applyView();}
    }else if(ptrs.size===1&&panStart){
      const scale=(panStart.vw!==undefined?panStart.vw:view.w)/rect.width;
      const dx=e.clientX-panStart.x,dy=e.clientY-panStart.y;
      if(Math.abs(dx)+Math.abs(dy)>10){moved=true;suppressTap=true;}
      if(moved){view.x=panStart.vx-dx*scale;view.y=panStart.vy-dy*scale;clampView();applyView();}
    }
    if(moved||ptrs.size===2){try{e.preventDefault();}catch(err){}}
  });
  const up=e=>{
    if(ptrs.size===1&&!moved&&!suppressTap){try{const p=svgPoint(e.clientX,e.clientY);tapRipple(p.x,p.y);}catch(err){}}
    ptrs.delete(e.pointerId);if(ptrs.size<2)pinch0=null;
    if(ptrs.size===1){const[rest]=[...ptrs.values()];panStart={x:rest.x,y:rest.y,vx:view.x,vy:view.y,vw:view.w};}
    if(ptrs.size===0){panStart=null;setTimeout(()=>{suppressTap=false;},50);}
  };
  svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',up);
  svg.addEventListener('wheel',e=>{e.preventDefault();const p=svgPoint(e.clientX,e.clientY);zoomAt(p.x,p.y,e.deltaY>0?1.25:0.8);},{passive:false});
  const zi=$('zoom-in'),zo=$('zoom-out'),zr=$('zoom-reset');
  if(zi)zi.onclick=()=>zoomAt(view.x+view.w/2,view.y+view.h/2,0.7);
  if(zo)zo.onclick=()=>zoomAt(view.x+view.w/2,view.y+view.h/2,1.45);
  if(zr)zr.onclick=resetView;
}
function tapRipple(x,y){const svg=$('map-svg');if(!svg)return;const r=document.createElementNS('http://www.w3.org/2000/svg','circle');r.setAttribute('cx',x);r.setAttribute('cy',y);r.setAttribute('r',6);r.setAttribute('class','tap-ripple');svg.appendChild(r);setTimeout(()=>r.remove(),500);}
function clearMapExtras(){document.querySelectorAll('#map-svg .loc-dot,#map-svg .loc-label,#map-svg .click-mark,#map-svg .match-mark').forEach(e=>e.remove());document.querySelectorAll('#map-svg .muni').forEach(p=>p.classList.remove('correct','wrong','flash','dim-region','pulse'));}
function muniEl(name){return document.querySelector(`#map-svg .muni[data-name="${name}"]`);}
function addDot(x,y,r,cls){const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r',r);c.setAttribute('class',cls);$('map-svg').appendChild(c);return c;}
function addLabel(x,y,text,cls){const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',x);t.setAttribute('y',y);t.setAttribute('text-anchor','middle');t.setAttribute('class','loc-label'+(cls?' '+cls:''));t.textContent=text;$('map-svg').appendChild(t);return t;}
function labelWrongMuni(name){const m=MUNIS[name];if(m)addLabel(m.cx,m.cy+4,name.replace(/\(.+\)$/,''),'bad');}
let MUNI_BBOX={};
function muniBBox(name){
  if(MUNI_BBOX[name])return MUNI_BBOX[name];
  const d=MUNIS[name].d,nums=d.match(/-?\d+\.?\d*/g).map(Number);
  let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  for(let i=0;i<nums.length;i+=2){if(nums[i]<minx)minx=nums[i];if(nums[i]>maxx)maxx=nums[i];if(nums[i+1]<miny)miny=nums[i+1];if(nums[i+1]>maxy)maxy=nums[i+1];}
  const pad=Math.max(maxx-minx,maxy-miny)*0.1;
  return MUNI_BBOX[name]={x:minx-pad,y:miny-pad,w:maxx-minx+pad*2,h:maxy-miny+pad*2};
}
let REGION_BBOX=null;
function regionBBox(region){
  if(!REGION_BBOX){REGION_BBOX={};
    for(const[n,m]of Object.entries(MUNIS)){const bb=muniBBox(n);const r=REGION_BBOX[m.region]||(REGION_BBOX[m.region]={minx:1e9,miny:1e9,maxx:-1e9,maxy:-1e9});r.minx=Math.min(r.minx,bb.x);r.miny=Math.min(r.miny,bb.y);r.maxx=Math.max(r.maxx,bb.x+bb.w);r.maxy=Math.max(r.maxy,bb.y+bb.h);}
  }
  return REGION_BBOX[region];
}
function fitViewTo(pts,pad){const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);let x0=Math.min(...xs)-pad,y0=Math.min(...ys)-pad,w=Math.max(...xs)-Math.min(...xs)+pad*2,h=Math.max(...ys)-Math.min(...ys)+pad*2;const s=Math.max(w,h,220);animateView(clampedTarget({x:x0-(s-w)/2,y:y0-(s-h)/2,w:s,h:s*VIEW0.h/VIEW0.w}));}
function fitRegion(region){const r=regionBBox(region);if(!r)return;fitViewTo([{x:r.minx,y:r.miny},{x:r.maxx,y:r.maxy}],26);}
function dimOtherRegions(region){if(region==='전체')return;document.querySelectorAll('#map-svg .muni').forEach(p=>{if(p.dataset.region!==region)p.classList.add('dim-region');});}
let activeMapTap=null;
function setMapTap(fn){clearMapTap();activeMapTap=fn;$('map-svg').addEventListener('click',fn);}
function clearMapTap(){if(activeMapTap){$('map-svg').removeEventListener('click',activeMapTap);activeMapTap=null;}}
function onMuniTap(fn){const handler=e=>{if(suppressTap||G.locked)return;const t=e.target.closest('.muni');if(!t)return;clearMapTap();fn(t,e);};setMapTap(handler);return clearMapTap;}
function addMatchMark(x,y,letter){const svg=$('map-svg'),g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','match-mark');g.innerHTML=`<circle cx="${x}" cy="${y}" r="13" fill="#E2574C" stroke="#FFFFFF" stroke-width="2.5"/><text x="${x}" y="${y+5}" text-anchor="middle" font-size="14" font-weight="800" fill="#FFFFFF">${letter}</text>`;svg.appendChild(g);return g;}


// ============================================================
// 홈 화면
// ============================================================
function renderHomeBoard(){
  const hb=$('home-board');if(!hb)return;
  hb.innerHTML='<div style="color:var(--dim);font-size:.83rem">🏆 랭킹 불러오는 중...</div>';
  fetchFirestoreBoard().then(list=>{
    if(!list.length){hb.innerHTML='<div style="color:var(--dim);font-size:.83rem">아직 기록이 없습니다!</div>';return;}
    const medal=['🥇','🥈','🥉'];
    hb.innerHTML='<div class="bd-group"><div class="bd-head">📊 전체 점수 랭킹</div>'+
      list.map((e,i)=>`<div class="bd-row"><span class="bd-rk">${medal[i]||(i+1)}</span><span class="bd-name">${e.name}</span><b class="bd-score">${e.score.toLocaleString()}점</b></div>`).join('')+'</div>';
  });
}

function initHome(){
  const chips=$('region-chips');if(!chips)return;
  chips.innerHTML='';
  REGIONS.forEach(r=>{const b=document.createElement('button');b.className='chip'+(G.region===r?' on':'');b.textContent=regionLabel(r);b.onclick=()=>{G.region=r;initHome();};chips.appendChild(b);});
  let rank=RANKS[0],next=null;
  for(const r of RANKS){if(xp>=r[0])rank=r;else{next=r;break;}}
  const streak=store.load('geo_streak',0),today=new Date().toDateString();
  const streakOn=store.load('geo_lastday','')=== today;
  const rb=$('rank-badge');if(rb)rb.innerHTML=rank[1]+(streak>=1?` <span class="streak-chip">${streakOn?'🔥':'⏳'} ${streak}일 연속</span>`:'');
  const xb=$('xp-bar');if(xb)xb.style.width=next?Math.min(100,(xp-rank[0])/(next[0]-rank[0])*100)+'%':'100%';
  const xt=$('xp-text');if(xt)xt.textContent=next?`다음 계급까지 ${next[0]-xp} XP`:'최고 계급 달성!';
  const ml=$('mastery-list');if(ml){
    ml.innerHTML='';
    REGIONS.slice(1).forEach(r=>{const s=stats[r]||{c:0,t:0};const pct=s.t?Math.round(s.c/s.t*100):0;
      ml.insertAdjacentHTML('beforeend',`<div class="mastery-row"><span class="m-name">${r}</span><div class="m-bar"><div class="m-fill" style="width:${pct}%"></div></div><span class="m-val">${pct}% (${s.c}/${s.t})</span></div>`);});
  }
  renderHomeBoard();updateGachaUI();renderPlayHero();renderBeginnerGuide();renderRecommend();
  renderDaily();renderMission();renderBoss();renderWanted();renderWeakReport();renderAchievements();checkAchievements();
  const fs=$('freq-span');if(fs)fs.textContent=`${FREQ_SPAN.span} 고3 학평·모평·수능 ${FREQ_SPAN.files}회분 — 빈출 지역은 게임에서 더 자주 출제`;
  const fl=$('freq-list');if(fl){
    fl.innerHTML='';const METRO_RE=/(특별시|광역시|특별자치시)$/;
    const top=Object.entries(FREQ).filter(([n])=>MUNIS[n]&&!METRO_RE.test(n)).sort((a,b)=>b[1].count-a[1].count).slice(0,12);
    const max=top.length?top[0][1].count:1;
    top.forEach(([name,v],i)=>{fl.insertAdjacentHTML('beforeend',`<div class="freq-row"><span class="f-rank">${i+1}</span><span class="f-name">${name.replace(/\(.+\)$/,'')}</span><div class="f-bar"><div class="f-fill" style="width:${Math.round(v.count/max*100)}%"></div></div><span class="f-val">${v.count}회·${v.exams}개 시험</span></div>`);});
  }
  initModeCarousel();
}

function initModeCarousel(){
  const car=$('mode-carousel');if(!car)return;
  const PLAY_MODES=[
    {m:'location',name:'📍 위치 사냥',desc:'이름·설명 보고 백지도 탭'},
    {m:'theme',name:'🏷️ 테마 게임',desc:'도청·축제·특산물 등 테마'},
    {m:'bingo',name:'🧩 빙고 게임',desc:'5×5 빙고판, 2번 틀리면 끝'},
    {m:'streak',name:'🔥 연승 모드',desc:'시간제한 없이, 틀리면 종료'},
    {m:'muniname',name:'🔎 지역 판독',desc:'깜빡이는 시·군 이름 맞히기'},
    {m:'detective',name:'🕵️ 지역 추리',desc:'힌트를 열며 추리'},
    {m:'climate',name:'🌡️ 기후 비교',desc:'두 지역 기후 상대 비교'},
    {m:'stats',name:'📊 통계 비교',desc:'두 시·도 통계 대결'},
    {m:'mcq',name:'📝 개념 퀴즈',desc:'4지선다 170여 문항'},
    {m:'ox',name:'⚡ 스피드 OX',desc:'60초 타임어택'},
    {m:'battle',name:'⚔️ 1:1 배틀',desc:'친구와 점수 대결'},
    {m:'explore',name:'🔍 백지도 탐색',desc:'지도에서 지역 학습'},
  ];
  car.innerHTML='';
  PLAY_MODES.forEach(pm=>{
    const card=document.createElement('div');card.className='mode-card';card.dataset.mode=pm.m;
    card.style.setProperty('--mc',MODE_COLOR[pm.m]||'#1278C2');
    card.innerHTML=`<div class="m-icon">${pm.name.split(' ')[0]}</div><div class="m-name">${pm.name.split(' ').slice(1).join(' ')}</div><div class="m-desc">${pm.desc}</div>`;
    card.onclick=()=>pm.m==='theme'?openThemeModal():startGame(pm.m);
    car.appendChild(card);
  });
  const prev=$('car-prev'),next=$('car-next');
  const step=()=>{const c=car.querySelector('.mode-card');return c?c.offsetWidth+11:180;};
  const updateArrows=()=>{if(!prev||!next)return;prev.disabled=car.scrollLeft<=2;next.disabled=car.scrollLeft>=car.scrollWidth-car.clientWidth-2;};
  if(prev)prev.onclick=()=>car.scrollBy({left:-step()*1.2,behavior:'smooth'});
  if(next)next.onclick=()=>car.scrollBy({left:step()*1.2,behavior:'smooth'});
  car.addEventListener('scroll',updateArrows,{passive:true});
  let down=false,sx=0,sl=0,moved=false;
  car.addEventListener('mousedown',e=>{down=true;moved=false;sx=e.pageX;sl=car.scrollLeft;car.classList.add('dragging');});
  window.addEventListener('mousemove',e=>{if(!down)return;const dx=e.pageX-sx;if(Math.abs(dx)>4)moved=true;car.scrollLeft=sl-dx;});
  window.addEventListener('mouseup',()=>{if(down){down=false;car.classList.remove('dragging');}});
  car.addEventListener('click',e=>{if(moved){e.preventDefault();e.stopPropagation();moved=false;}},true);
  car.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){car.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});
  setTimeout(updateArrows,100);
}

function recommendAction(){
  const bossCand=BOSS_REGIONS.filter(r=>bossUnlocked(r)&&!titles[r]).sort((a,b)=>bossMastery(b)-bossMastery(a))[0];
  const wn=Object.keys(wanted).length;
  if(bossCand)return{text:`${regionLabel(bossCand)} 숙련도 ${Math.round(bossMastery(bossCand)*100)}%! 보스전 도전 각이야 👹`,label:'보스전 도전',action:()=>startGame('boss',bossCand)};
  if(wn>0)return{text:`최근 틀린 지역 ${wn}곳이 수배 중! 이것부터 잡고 가자 🔍`,label:`오답 ${wn}곳 복습`,action:()=>{G.region='전체';startGame('wanted');}};
  if(xp<300)return{text:'처음이라면 백지도 탐색으로 지도와 친해져 볼까? 🗺️',label:'백지도 탐색',action:()=>startGame('explore')};
  const weak=BOSS_REGIONS.filter(r=>{const s=stats[r];return s&&s.t>=3;}).sort((a,b)=>bossMastery(a)-bossMastery(b))[0];
  if(weak&&bossMastery(weak)<0.7)return{text:`${regionLabel(weak)}이 조금 약해. 위치 사냥으로 다져볼까? 💪`,label:`${regionLabel(weak)} 연습`,action:()=>{G.region=weak;startGame('location');}};
  return{text:'오늘의 미션부터 깨 보자! 🎯',label:'위치 사냥 시작',action:()=>{G.region='전체';startGame('location');}};
}
function renderRecommend(){const bubble=$('rec-bubble'),btn=$('rec-btn');if(!bubble||!btn)return;const r=recommendAction();bubble.textContent=r.text;btn.textContent=r.label;btn.onclick=r.action;}
function renderPlayHero(){
  const box=$('play-hero');if(!box)return;
  const r=recommendAction();ensureMission();
  const done=mission.list.filter(m=>m.done).length,total=mission.list.length;
  box.innerHTML=`<div class="ph-label">오늘의 추천 한 판</div><div class="ph-text">${r.text}</div><button class="ph-btn" id="ph-start">▶ ${r.label}</button><button class="ph-mission" id="ph-mission">🎯 오늘의 미션 ${done}/${total} 달성 · 보러 가기 →</button>`;
  const phs=$('ph-start');if(phs)phs.onclick=r.action;
  const phm=$('ph-mission');if(phm)phm.onclick=()=>{const t=document.querySelector('.tab-btn[data-tab="challenge"]');if(t)t.click();};
}
function renderBeginnerGuide(){
  const box=$('beginner-guide');if(!box)return;
  if(xp>=300){box.style.display='none';return;}
  box.style.display='';
  const steps=[{m:'explore',n:'1 · 백지도 탐색',d:'지도와 친해지기'},{m:'location',n:'2 · 위치 사냥',d:'위치 맞히기'},{m:'muniname',n:'3 · 지역 판독',d:'이름 맞히기'},{m:'mcq',n:'4 · 개념 퀴즈',d:'개념 정리'},{m:'climate',n:'5 · 기후·통계',d:'비교 분석'}];
  box.innerHTML='<div class="bg-title">🔰 처음이라면 이 순서를 추천해요</div><div class="bg-steps">'+steps.map(s=>`<button class="bg-step" data-m="${s.m}"><b>${s.n}</b><small>${s.d}</small></button>`).join('')+'</div>';
  box.querySelectorAll('.bg-step').forEach(b=>b.onclick=()=>startGame(b.dataset.m));
}
function renderWeakReport(){
  const box=$('weak-body');if(!box)return;
  const regs=BOSS_REGIONS.map(r=>({r,s:stats[r]||{c:0,t:0}})).filter(x=>x.s.t>=3).map(x=>({r:x.r,pct:Math.round(x.s.c/x.s.t*100)})).sort((a,b)=>a.pct-b.pct);
  const misses=Object.entries(wanted).map(([k,v])=>({k,miss:v.miss||0})).filter(x=>x.miss>0).sort((a,b)=>b.miss-a.miss).slice(0,8);
  if(!regs.length&&!misses.length){box.innerHTML='<div style="color:var(--dim);font-size:13px">아직 분석할 데이터가 부족해요 📊</div>';return;}
  let html='';
  if(regs.length){
    html+='<div class="wr-head">권역별 정답률 (약한 순)</div>';
    html+=regs.slice(0,3).map(x=>{const col=x.pct<50?'var(--red)':x.pct<70?'var(--gold)':'var(--green)';return`<div class="wr-row"><span class="wr-name">${regionLabel(x.r)}</span><div class="wr-bar"><div class="wr-fill" style="width:${x.pct}%;background:${col}"></div></div><span class="wr-val">${x.pct}%</span></div>`;}).join('');
    html+=`<button class="wr-btn" id="wr-practice">🎯 ${regionLabel(regs[0].r)} 집중 연습</button>`;
  }
  if(misses.length){
    html+='<div class="wr-head" style="margin-top:13px">자주 틀린 지역</div>';
    html+=`<div class="wr-chips">${misses.map(m=>`<span class="wr-chip">${m.k.replace(/\(.+\)$/,'')} <b>${m.miss}회</b></span>`).join('')}</div>`;
    html+=`<button class="wr-btn ghost" id="wr-wanted">🔍 틀린 지역만 복습 (${Math.min(Object.keys(wanted).length,MODE_INFO.wanted.n)}문제)</button>`;
  }
  box.innerHTML=html;
  const wp=$('wr-practice');if(wp)wp.onclick=()=>{G.region=regs[0].r;startGame('location');};
  const ww=$('wr-wanted');if(ww)ww.onclick=()=>{G.region='전체';startGame('wanted');};
}
function renderBoss(){
  const box=$('boss-body');if(!box)return;
  box.innerHTML=BOSS_REGIONS.map(r=>{const m=Math.round(bossMastery(r)*100),unlocked=bossUnlocked(r),cleared=!!titles[r];
    const right=cleared?`<span class="boss-tag">🏆 정복</span>`:unlocked?`<span class="boss-go">도전 ▶</span>`:`<span class="boss-lock">🔒 ${m}%</span>`;
    return`<button class="boss-btn${unlocked?'':' locked'}${cleared?' cleared':''}" data-region="${r}" ${unlocked?'':'disabled'}><span class="boss-name">${regionLabel(r)}</span>${right}</button>`;}).join('');
  box.querySelectorAll('.boss-btn:not([disabled])').forEach(b=>b.onclick=()=>startGame('boss',b.dataset.region));
}
function renderWanted(){
  const box=$('wanted-body');if(!box)return;
  const keys=Object.keys(wanted).sort((a,b)=>wanted[b].miss-wanted[a].miss);
  if(!keys.length){box.innerHTML='<div style="font-size:13px;color:var(--dim2)">수배 중인 지역이 없습니다.</div>';return;}
  const danger=keys.filter(m=>wanted[m].miss>=3).length;
  const chips=keys.map(m=>{const w=wanted[m],dg=w.miss>=3;return`<span class="wanted-chip${dg?' danger':''}">${dg?'🚨 ':''}${muniShort(m)}<small>${w.miss}회</small></span>`;}).join('');
  box.innerHTML=`<div class="wanted-sub">${keys.length}개 지역 수배 중${danger?` · <b style="color:var(--red)">위험 ${danger}곳</b>`:''}</div><div class="wanted-chips">${chips}</div><button class="primary-btn" id="btn-wanted-review">🎯 수배 지역만 복습 (${Math.min(keys.length,MODE_INFO.wanted.n)}문제)</button>`;
  const bwr=$('btn-wanted-review');if(bwr)bwr.onclick=()=>{G.region='전체';startGame('wanted');};
}
function renderMission(){
  const box=$('mission-body');if(!box)return;
  ensureMission();
  box.innerHTML=mission.list.map(it=>{
    const d=missionDef(it.id);if(!d)return'';
    const prog=Math.min(it.prog,d.goal),pct=Math.round(prog/d.goal*100);
    const state=it.claimed?'<span class="ms-claimed">✓ 완료</span>':it.done?`<button class="ms-claim" data-mid="${it.id}">받기 🪙${d.reward.c}</button>`:`<span class="ms-prog">${prog}/${d.goal}</span>`;
    return`<div class="mission-row${it.done?' done':''}"><div class="ms-top"><span class="ms-label">${d.label}</span>${state}</div><div class="ms-bar"><div class="ms-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
  box.querySelectorAll('.ms-claim').forEach(b=>b.onclick=()=>claimMission(b.dataset.mid));
}
function renderDaily(){
  const box=$('daily-body');if(!box)return;
  const today=dayKey(),done=store.load('geo_daily_done','')=== today;
  const myScore=store.load('geo_daily_score',null);
  box.innerHTML=`<button class="primary-btn" id="btn-daily">${done?'✓ 오늘 완료 — 다시 풀기(연습)':'🔁 오늘의 도전 시작 (10문제)'}</button>${done&&myScore!=null?`<div class="daily-mine">오늘 내 기록: <b>${myScore}점</b></div>`:''}`;
  const bd=$('btn-daily');if(bd)bd.onclick=()=>startGame('daily');
}

function openThemeModal(){
  const box=$('theme-list');if(!box){startGame('theme','docheong');return;}
  box.innerHTML='';
  buildThemes().forEach(t=>{const b=document.createElement('button');b.className='theme-pick';b.innerHTML=`<span class="tp-label">${t.label}</span><span class="tp-count">${t.items.length}개 지역</span>`;b.onclick=()=>{$('theme-modal').classList.add('hidden');startGame('theme',t.key);};box.appendChild(b);});
  $('theme-modal').classList.remove('hidden');
}
function openThemeLearn(){
  const box=$('themelearn-list');if(!box)return;
  const ttl=$('themelearn-title');if(ttl)ttl.textContent='🗂️ 테마별 학습';
  box.classList.remove('study');box.innerHTML='';
  buildThemes().forEach(t=>{const b=document.createElement('button');b.className='theme-pick';b.innerHTML=`<span class="tp-label">${t.label}</span><span class="tp-count">${t.items.length}개 지역</span>`;b.onclick=()=>showThemeLearn(t);box.appendChild(b);});
  $('themelearn-modal').classList.remove('hidden');
}
function showThemeLearn(t){
  const ttl=$('themelearn-title');if(ttl)ttl.textContent=t.label;
  const box=$('themelearn-list');box.classList.add('study');
  box.innerHTML='<div class="tl-list">'+t.items.map(it=>{const muni=it.a.replace(/\(.+\)$/,''),prov=(MUNIS[it.a]||{}).prov||'';return`<div class="tl-item"><div class="tl-top"><b>${muni}</b> <span class="tl-prov">${prov}</span></div><div class="tl-desc">${it.c}</div></div>`;}).join('')+'</div>'
    +`<div class="tl-actions"><button class="ghost-btn" id="tl-back">← 테마 목록</button><button class="primary-btn" id="tl-quiz">🏷️ 이 테마로 퀴즈</button></div>`;
  const tlb=$('tl-back');if(tlb)tlb.onclick=openThemeLearn;
  const tlq=$('tl-quiz');if(tlq)tlq.onclick=()=>{$('themelearn-modal').classList.add('hidden');startGame('theme',t.key);};
}
function openModesModal(){
  const box=$('modes-list');if(!box)return;box.innerHTML='';
  const PLAY_MODES=[{m:'location',name:'📍 위치 사냥',desc:'이름·설명 보고 백지도 탭'},{m:'theme',name:'🏷️ 테마 게임',desc:'도청·축제·특산물 등 테마'},{m:'bingo',name:'🧩 빙고 게임',desc:'5×5 빙고판, 2번 틀리면 끝'},{m:'streak',name:'🔥 연승 모드',desc:'시간제한 없이, 틀리면 종료'},{m:'muniname',name:'🔎 지역 판독',desc:'깜빡이는 시·군 이름 맞히기'},{m:'detective',name:'🕵️ 지역 추리',desc:'힌트를 열며 추리'},{m:'climate',name:'🌡️ 기후 비교',desc:'두 지역 기후 상대 비교'},{m:'stats',name:'📊 통계 비교',desc:'두 시·도 통계 대결'},{m:'mcq',name:'📝 개념 퀴즈',desc:'4지선다 170여 문항'},{m:'ox',name:'⚡ 스피드 OX',desc:'60초 타임어택'},{m:'battle',name:'⚔️ 1:1 배틀',desc:'친구와 점수 대결'}];
  PLAY_MODES.forEach(pm=>{const b=document.createElement('button');b.className='mode-tile';b.style.setProperty('--mc',MODE_COLOR[pm.m]||'#1278C2');b.innerHTML=`<span class="mt-name">${pm.name}</span><span class="mt-desc">${pm.desc}</span>`;b.onclick=()=>{$('modes-modal').classList.add('hidden');pm.m==='theme'?openThemeModal():startGame(pm.m);};box.appendChild(b);});
  $('modes-modal').classList.remove('hidden');
}


// ============================================================
// 업적
// ============================================================
const ACHIEVEMENTS=[
  {id:'first',icon:'🌱',name:'첫 발걸음',desc:'게임을 처음 완료',reward:5,check:()=>xp>0},
  {id:'rank',icon:'🗺️',name:'지도 읽는 자',desc:'XP 1600 달성',reward:10,check:()=>xp>=1600},
  {id:'combo15',icon:'⚡',name:'콤보 마스터',desc:'한 게임 15콤보',reward:15,check:()=>store.load('geo_maxcombo',0)>=15},
  {id:'streak10',icon:'🔥',name:'10연승',desc:'연승 모드 10연승',reward:15,check:()=>store.load('geo_beststreak',0)>=10},
  {id:'streak25',icon:'🌋',name:'연승 괴물',desc:'연승 모드 25연승',reward:30,check:()=>store.load('geo_beststreak',0)>=25},
  {id:'bingo',icon:'🧩',name:'빙고 블랙아웃',desc:'빙고판 25칸 완성',reward:20,check:()=>!!store.load('geo_bingo_black',false)},
  {id:'daily',icon:'🔁',name:'오늘의 도전자',desc:'일일 도전 완료',reward:10,check:()=>!!store.load('geo_daily_done','')},
  {id:'col50',icon:'📒',name:'수집가',desc:'지역 카드 50종 수집',reward:15,check:()=>Object.keys(cards).length>=50},
  {id:'col100',icon:'🏞️',name:'도감 마스터',desc:'지역 카드 100종 수집',reward:30,check:()=>Object.keys(cards).length>=100},
  {id:'boss1',icon:'👹',name:'권역 정복자',desc:'권역 보스 1곳 격파',reward:15,check:()=>Object.keys(titles).length>=1},
  {id:'bossAll',icon:'👑',name:'국토 통일',desc:'모든 권역 보스 격파',reward:50,check:()=>BOSS_REGIONS.every(r=>titles[r])},
  {id:'attend7',icon:'📅',name:'개근상',desc:'7일 연속 출석',reward:20,check:()=>store.load('geo_streak',0)>=7},
];
function checkAchievements(){
  const newly=[];
  ACHIEVEMENTS.forEach(a=>{if(!ach[a.id]){let ok=false;try{ok=a.check();}catch(e){}if(ok){ach[a.id]=true;newly.push(a);}}});
  if(newly.length){store.save('geo_ach',ach);const bonus=newly.reduce((s,a)=>s+(a.reward||0),0);if(bonus){coins+=bonus;store.save('geo_coins',coins);updateGachaUI();}achToast(newly,bonus);renderAchievements();}
}
function achToast(list,bonus){
  const t=document.createElement('div');t.className='ach-toast';
  t.innerHTML=`<div class="at-title">🏅 업적 달성!</div>`+list.map(a=>`<div class="at-row"><span class="at-ic">${a.icon}</span> ${a.name}</div>`).join('')+(bonus?`<div class="at-bonus">보너스 +${bonus}🪙</div>`:'');
  document.body.appendChild(t);setTimeout(()=>t.classList.add('show'),20);setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400);},3400);
}
function renderAchievements(){
  const box=$('ach-list');if(!box)return;
  const got=ACHIEVEMENTS.filter(a=>ach[a.id]).length;
  const cnt=$('ach-count');if(cnt)cnt.textContent=`${got}/${ACHIEVEMENTS.length}`;
  box.innerHTML=ACHIEVEMENTS.map(a=>{const on=!!ach[a.id];return`<div class="ach-item${on?' on':''}"><span class="ach-ic">${on?a.icon:'🔒'}</span><div class="ach-txt"><b>${a.name}</b><small>${a.desc}</small></div></div>`;}).join('');
}

// ============================================================
// 미션
// ============================================================
const MISSION_POOL=[
  {id:'reg-jeju',label:'제주권 문제 5개 맞히기',goal:5,type:'solve',region:'제주',reward:{c:5,x:40}},
  {id:'reg-gw',label:'강원권 문제 6개 맞히기',goal:6,type:'solve',region:'강원',reward:{c:5,x:40}},
  {id:'reg-honam',label:'호남권 문제 6개 맞히기',goal:6,type:'solve',region:'호남',reward:{c:5,x:40}},
  {id:'reg-chung',label:'충청권 문제 6개 맞히기',goal:6,type:'solve',region:'충청',reward:{c:5,x:40}},
  {id:'reg-yeong',label:'영남권 문제 6개 맞히기',goal:6,type:'solve',region:'영남',reward:{c:5,x:40}},
  {id:'reg-sudo',label:'수도권 문제 6개 맞히기',goal:6,type:'solve',region:'수도권',reward:{c:5,x:40}},
  {id:'mode-clim',label:'기후 비교 3문제 맞히기',goal:3,type:'mode',mode:'climate',reward:{c:6,x:45}},
  {id:'mode-stat',label:'통계 비교 3문제 맞히기',goal:3,type:'mode',mode:'stats',reward:{c:6,x:45}},
  {id:'mode-loc',label:'위치 사냥 8문제 맞히기',goal:8,type:'mode',mode:'location',reward:{c:6,x:45}},
  {id:'card-new',label:'지역 카드 1장 새로 획득',goal:1,type:'card',reward:{c:4,x:30}},
  {id:'combo7',label:'한 게임에서 7콤보 달성',goal:7,type:'combo',reward:{c:6,x:50}},
];
const MISSION_N=3;
function missionDef(id){return MISSION_POOL.find(m=>m.id===id);}
function pickMissions(dateStr,k){
  let seed=hashStr(dateStr)||1;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;seed>>>=0;return seed/4294967296;};
  const idx=MISSION_POOL.map((_,i)=>i);for(let i=idx.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}
  return idx.slice(0,k).map(i=>({id:MISSION_POOL[i].id,prog:0,done:false,claimed:false,seen:[]}));
}
function ensureMission(){
  const t=new Date().toDateString();
  if(!mission||mission.date!==t){mission={date:t,list:pickMissions(t,MISSION_N)};store.save('geo_mission',mission);}
  return mission;
}
function missionProgress(ev){
  ensureMission();let changed=false;
  for(const it of mission.list){
    if(it.done)continue;const d=missionDef(it.id);if(!d)continue;
    if(d.type==='solve'&&ev.region===d.region&&ev.correct){it.prog++;changed=true;}
    else if(d.type==='mode'&&ev.mode===d.mode&&ev.correct){it.prog++;changed=true;}
    else if(d.type==='card'&&ev.isNew){it.prog++;changed=true;}
    else if(d.type==='combo'&&typeof ev.combo==='number'){if(ev.combo>it.prog){it.prog=ev.combo;changed=true;}}
    if(it.prog>=d.goal&&!it.done){it.done=true;changed=true;}
  }
  if(changed){store.save('geo_mission',mission);if($('mission-body')&&$('screen-home')?.classList.contains('active'))renderMission();}
}
function claimMission(id){
  const it=mission&&mission.list.find(x=>x.id===id);if(!it||!it.done||it.claimed)return;
  const d=missionDef(id);if(!d)return;it.claimed=true;store.save('geo_mission',mission);
  coins+=d.reward.c;store.save('geo_coins',coins);xp+=d.reward.x;store.save('geo_xp',xp);
  updateGachaUI();renderMission();
}

// ============================================================
// 게임 흐름
// ============================================================
function pool(mode){
  const r=G.region;
  if(mode==='location'||mode==='detective'){const base=locPool(),L=base.filter(l=>r==='전체'||l.region===r);return L.length>=4?L:base;}
  if(mode==='muniname'){const M=Object.keys(MUNIS).filter(n=>r==='전체'||MUNIS[n].region===r);return M.length>=4?M:Object.keys(MUNIS);}
  if(mode==='climate'){let M=CLIMATE_SETS.filter(s=>r==='전체'||s.st.some(n=>(CLIMATE.find(c=>c.name===n)||{}).region===r)).map(s=>({kind:'match',set:s}));return M.length>=4?M:CLIMATE_SETS.map(s=>({kind:'match',set:s}));}
  if(mode==='stats'){let P=STAT_SETS.filter(s=>r==='전체'||s.sd.some(n=>PROVINCES[n]?.region===r));return P.length>=2?P:STAT_SETS;}
  if(mode==='mcq'){const M=MCQ.filter(q=>r==='전체'||q.region===r);return M.length?M:MCQ;}
  if(mode==='ox'){const O=OX.filter(q=>r==='전체'||q.region===r);return O.length?O:OX;}
  return[];
}
function bossQueue(region){
  const prevR=G.region;G.region=region;
  const locs=sampleLocQueue(pool('location'),3),munis=weightedSample(pool('muniname'),3,n=>n);
  const mcqs=shuffle(pool('mcq')).slice(0,2),oxs=shuffle(pool('ox')).slice(0,1),clim=shuffle(pool('climate')).slice(0,1);
  G.region=prevR;const q=[];
  locs.forEach(l=>l&&q.push({btype:'location',item:l}));munis.forEach(m=>m&&q.push({btype:'muniname',item:m}));
  mcqs.forEach(m=>m&&q.push({btype:'mcq',item:m}));oxs.forEach(o=>o&&q.push({btype:'ox',item:o}));clim.forEach(c=>c&&q.push({btype:'climate',item:c}));
  return shuffle(q).slice(0,MODE_INFO.boss.n);
}
function streakRefill(n){
  const out=[],locs=sampleLocQueue(pool('location'),Math.ceil(n*0.5)),munis=weightedSample(pool('muniname'),Math.ceil(n*0.2),x=>x);
  const mcqs=shuffle(pool('mcq')).slice(0,Math.ceil(n*0.2)),oxs=shuffle(pool('ox')).slice(0,Math.ceil(n*0.15));
  locs.forEach(l=>l&&out.push({btype:'location',item:l}));munis.forEach(m=>m&&out.push({btype:'muniname',item:m}));
  mcqs.forEach(m=>m&&out.push({btype:'mcq',item:m}));oxs.forEach(o=>o&&out.push({btype:'ox',item:o}));
  return shuffle(out);
}
function dailyQueue(){
  const rnd=seededRnd('daily-'+dayKey()),pick=a=>a[Math.floor(rnd()*a.length)];
  const locs=locPool().filter(l=>l.accept&&(l.fact||l.desc)),munis=Object.keys(MUNIS);
  const plan=['location','mcq','location','muniname','ox','location','mcq','muniname','ox','location'];
  return plan.map(t=>t==='location'?{btype:'location',item:pick(locs)}:t==='muniname'?{btype:'muniname',item:pick(munis)}:t==='mcq'?{btype:'mcq',item:pick(MCQ)}:{btype:'ox',item:pick(OX)});
}
function wantedPool(){
  return Object.keys(wanted).map(muni=>{const l=LOCATIONS.find(x=>x.accept.includes(muni));if(l)return l;const mu=MUNIS[muni];if(!mu)return null;return{name:muniShort(muni),x:mu.cx,y:mu.cy,region:mu.region,accept:[muni],fact:`${mu.prov} ${muniShort(muni)} — 백지도에서 위치를 다시 확인하세요.`};}).filter(Boolean);
}

function startGame(mode,opt){
  G.mode=mode;G.idx=0;G.score=0;G.combo=0;G.maxCombo=0;G.correctCnt=0;G.locked=false;
  G.battle=null;G.bossRegion=null;G.noTimer=(mode==='streak');G.lastCorrect=true;G.bingo=null;
  if(mode==='boss'){G.bossRegion=opt;G.region=opt;}
  if(!svgBuilt){buildMap();initMapGestures();}
  clearMapExtras();resetView();stopTimer();clearMapTap();
  const ms=$('map-svg');if(ms)ms.onclick=null;
  const tip=$('warmup-tip');if(tip)tip.classList.add('hidden');
  const bb=$('boss-bar');if(bb)bb.classList.toggle('hidden',mode!=='boss');
  const info=MODE_INFO[mode];
  const sg=$('screen-game');if(sg)sg.style.setProperty('--mode-c',MODE_COLOR[mode]||'#1278C2');
  const gt=$('game-title');if(gt)gt.textContent=mode==='boss'?`👹 ${regionLabel(opt)} 보스전`:info.title+(G.region!=='전체'?` · ${G.region}`:'');
  const ti=$('turn-indicator');if(ti)ti.classList.add('hidden');
  const mp=$('map-pane');if(mp)mp.style.display=info.useMap?'block':'none';
  const gb=$('game-body');if(gb)gb.classList.toggle('no-map',!info.useMap);
  const bn=$('btn-next');if(bn)bn.classList.add('hidden');
  const fb=$('feedback-box');if(fb)fb.classList.add('hidden');

  if(mode==='explore')return startExplore();
  if(mode==='ox'){G.queue=shuffle(pool('ox'));G.oxEnd=Date.now()+60000;}
  else if(mode==='battle'){
    const types=['location','muniname','detective','climate','stats','mcq','ox'];let q=[];
    for(let i=0;i<MODE_INFO.battle.n;i++){const t=types[Math.floor(Math.random()*types.length)];const p=shuffle(pool(t));q.push({btype:t,item:p[i%p.length]});}
    G.queue=q;const n1=prompt('플레이어 1 이름?','P1')||'P1';const n2=prompt('플레이어 2 이름?','P2')||'P2';
    G.battle={turn:1,scores:[0,0],combos:[0,0],correct:[0,0],names:[n1.slice(0,8),n2.slice(0,8)]};
  }
  else if(mode==='location'||mode==='detective'){G.queue=sampleLocQueue(pool(mode),MODE_INFO[mode].n);}
  else if(mode==='wanted'){const wp=wantedPool();G.queue=sampleLocQueue(wp,Math.min(wp.length,MODE_INFO.wanted.n));}
  else if(mode==='muniname'){G.queue=weightedSample(pool(mode),MODE_INFO[mode].n,n=>n);}
  else if(mode==='boss'){G.queue=bossQueue(opt);}
  else if(mode==='bingo'){const cells=buildBingo();G.bingo={cells,wrong:0,lineKeys:new Set(),targetIdx:-1};G.queue=shuffle(cells.slice());renderBingoGrid();}
  else if(mode==='streak'){G.queue=streakRefill(30);}
  else if(mode==='daily'){G.queue=dailyQueue();}
  else if(mode==='theme'){
    const theme=themeByKey(opt)||buildThemes()[0];if(gt)gt.textContent=theme.label;
    const useMCQ=theme.key==='special';const its=shuffle(theme.items).slice(0,Math.min(theme.items.length,MODE_INFO.theme.n));
    const allNames=theme.items.map(it=>it.a.replace(/\(.+\)$/,''));
    G.queue=its.map(it=>{const mu=MUNIS[it.a];return{def:{label:theme.label},mcq:useMCQ,siblings:allNames,loc:{name:it.a.replace(/\(.+\)$/,''),x:mu.cx,y:mu.cy,region:mu.region,accept:[it.a],fact:it.c}};});
  }
  else{G.queue=shuffle(pool(mode)).slice(0,MODE_INFO[mode].n);}
  if(mode==='boss')hudUpdate();
  show('screen-game');nextQuestion();
}

function hudUpdate(){
  const total=(G.mode==='ox'||G.mode==='streak')?'∞':G.queue.length;
  const hq=$('hud-qnum'),ht=$('hud-qtotal');if(hq)hq.textContent=Math.min(G.idx+1,G.queue.length);if(ht)ht.textContent=total;
  if(G.battle){const b=G.battle;const hc=$('hud-combo'),hs=$('hud-score'),ti=$('turn-indicator');
    if(hc)hc.textContent=b.combos[b.turn-1];if(hs)hs.textContent=`${b.names[0]} ${b.scores[0]} : ${b.scores[1]} ${b.names[1]}`;
    if(ti){ti.classList.remove('hidden','p1','p2');ti.classList.add(b.turn===1?'p1':'p2');ti.textContent=`▶ ${b.names[b.turn-1]} 차례`;}
  }else{const hc=$('hud-combo'),hs=$('hud-score');if(hc)hc.textContent=G.combo;if(hs)hs.textContent=G.score;}
  if(G.mode==='boss'){const bb=$('boss-bar');if(!bb)return;const max=G.queue.length,hp=Math.max(0,max-G.correctCnt),pct=Math.round(hp/max*100),need=Math.ceil(max*0.7);
    bb.innerHTML=`<div><span>👹 ${regionLabel(G.bossRegion)} 보스 HP</span><span>${hp}/${max} · ${need}타 격파</span></div><div class="boss-hp-bar"><div class="boss-hp-fill" style="width:${pct}%"></div></div>`;}
}

function startTimer(sec,onTimeout){
  stopTimer();const wrap=$('timer-bar-wrap');
  if(G.noTimer){if(wrap)wrap.style.display='none';const t=$('warmup-tip');if(t)t.classList.add('hidden');return;}
  if(wrap)wrap.style.display='';
  const warm=G.idx===0&&WARMUP_MODES.has(G.mode);if(warm)sec=Math.round(sec*1.6)+8;
  const tip=$('warmup-tip');if(tip){tip.classList.toggle('hidden',!warm);if(warm)tip.textContent='🔰 첫 문제는 시간이 넉넉해요!';}
  G.timeMax=sec;G.timeLeft=sec;const bar=$('timer-bar');if(bar){bar.style.width='100%';bar.classList.remove('danger');}
  G.timer=setInterval(()=>{G.timeLeft-=0.1;const pct=Math.max(0,G.timeLeft/G.timeMax*100);if(bar){bar.style.width=pct+'%';if(pct<30)bar.classList.add('danger');}if(G.timeLeft<=0){stopTimer();onTimeout();}},100);
}
function stopTimer(){if(G.timer){clearInterval(G.timer);G.timer=null;}}
function timeBonus(){return G.noTimer||!G.timeMax?0:Math.round(Math.max(0,G.timeLeft)/G.timeMax*50);}

const WRONG_PENALTY=30;
function award(correct,base){
  let pts=0;
  if(G.battle){const i=G.battle.turn-1;if(correct){G.battle.combos[i]++;G.battle.correct[i]++;pts=base+timeBonus()+G.battle.combos[i]*10;G.battle.scores[i]+=pts;}else{G.battle.combos[i]=0;pts=-WRONG_PENALTY;G.battle.scores[i]+=pts;}}
  else{G.lastCorrect=correct;if(correct){G.combo++;G.maxCombo=Math.max(G.maxCombo,G.combo);G.correctCnt++;pts=base+timeBonus()+G.combo*10;G.score+=pts;}else{G.combo=0;pts=-WRONG_PENALTY;G.score+=pts;}missionProgress({mode:G.mode,correct,combo:G.combo});}
  return pts;
}
function recordStat(region,correct){if(!region)return;const s=stats[region]||(stats[region]={c:0,t:0});s.t++;if(correct)s.c++;store.save('geo_stats',stats);missionProgress({region,correct});}
function logResult(muni,hit){if(!muni)return;if(hit){const w=wanted[muni];if(!w)return;w.streak=(w.streak||0)+1;if(w.streak>=2)delete wanted[muni];}else{const w=wanted[muni]||(wanted[muni]={miss:0,streak:0});w.miss++;w.streak=0;}store.save('geo_wanted',wanted);missionProgress({muni,correct:hit});}

function nextQuestion(){
  G.locked=false;clearMapTap();
  const fb=$('feedback-box');if(fb)fb.classList.add('hidden');
  const bn=$('btn-next');if(bn)bn.classList.add('hidden');
  clearMapExtras();try{window.scrollTo(0,0);}catch(e){}
  if(viewAnimId){cancelAnimationFrame(viewAnimId);viewAnimId=null;}view={...VIEW0};applyView();
  if(G.mode==='ox'){if(Date.now()>=G.oxEnd||G.idx>=G.queue.length)return endGame();}
  else if(G.mode==='streak'){if(G.idx>=G.queue.length-2)G.queue=G.queue.concat(streakRefill(30));}
  else if(G.idx>=G.queue.length)return endGame();
  hudUpdate();
  let item=G.queue[G.idx],type=G.mode;
  if(G.mode==='battle'||G.mode==='boss'||G.mode==='streak'||G.mode==='daily'){type=item.btype;item=item.item;const noMap=(type==='mcq'||type==='ox');const mp=$('map-pane');if(mp)mp.style.display=noMap?'none':'block';const gb=$('game-body');if(gb)gb.classList.toggle('no-map',noMap);}
  if(G.mode==='climate'){const noMap=item.kind==='order';const mp=$('map-pane');if(mp)mp.style.display=noMap?'none':'block';const gb=$('game-body');if(gb)gb.classList.toggle('no-map',noMap);}
  if(G.mode==='theme'){const noMap=!!item.mcq;const mp=$('map-pane');if(mp)mp.style.display=noMap?'none':'block';const gb=$('game-body');if(gb)gb.classList.toggle('no-map',noMap);}
  G.curType=type;
  if(type==='location'||type==='wanted')askLocation(item);
  else if(type==='bingo')askBingo(item);
  else if(type==='theme')item.mcq?askThemeMCQ(item):askTheme(item);
  else if(type==='muniname')askMuniName(item);
  else if(type==='detective')askDetective(item);
  else if(type==='climate')askClimate(item);
  else if(type==='stats')askStats(item);
  else if(type==='mcq')askMCQ(item);
  else if(type==='ox')askOX(item);
}
function afterAnswer(){
  G.idx++;if(G.battle)G.battle.turn=G.battle.turn===1?2:1;
  if(G.mode==='streak'&&!G.lastCorrect){const bn=$('btn-next');if(bn)bn.classList.add('hidden');setTimeout(()=>endGame(),1300);return;}
  if(G.mode==='ox'){setTimeout(nextQuestion,900);}else{const bn=$('btn-next');if(bn)bn.classList.remove('hidden');}
}
function scorePop(pts){const host=document.querySelector('.hud .score');if(!host||!pts)return;const el=document.createElement('span');el.className='score-pop'+(pts<0?' minus':'');el.textContent=(pts>0?'+':'')+pts;host.appendChild(el);setTimeout(()=>el.remove(),1000);}
const MASCOT_VER='?v=20260616a';
function feedback(correct,head,body,pts){
  const fb=$('feedback-box');if(!fb)return;
  const combo=G.battle?G.battle.combos[G.battle.turn-1]:G.combo;
  let flair='';if(correct&&combo>=2)flair=combo>=7?` · ${combo}연속! 백지도가 머릿속에 있다 🗺️✨`:combo>=5?` · ${combo}연속! 지리 감각 폭발 🔥🔥`:combo>=3?` · ${combo}연속 🔥`:` · ${combo}연속!`;
  const face=`<img class="fb-mascot ${correct?'happy':'sad'}" src="${correct?'guide-correct.png':'guide-think.png'}${MASCOT_VER}" alt="">`;
  fb.className='feedback-box '+(correct?'good':'bad');
  const ptsTag=pts?` <span class="fb-pts${pts<0?' minus':''}">${pts>0?'+':''}${pts}점</span>`:'';
  const REGION_TAP_TYPES=['location','wanted','theme','muniname','detective','bingo'];
  const note=(!correct&&REGION_TAP_TYPES.includes(G.curType))?'<div class="fb-note">📌 이 지역은 [챌린지] 탭 오답 수배서에 등록됐어요 — 나중에 복습!</div>':'';
  fb.innerHTML=`<div class="fb-head">${face}${head}${flair}${ptsTag}</div>${body}${note}`;
  fb.classList.remove('hidden');fb.classList.add('pop');setTimeout(()=>fb.classList.remove('pop'),400);
  if(window.innerWidth<=820)setTimeout(()=>fb.scrollIntoView({behavior:'smooth',block:'center'}),60);
  try{if(navigator.vibrate)navigator.vibrate(correct?25:[50,40,50]);}catch(e){}
  if(pts)scorePop(pts);
}


// ============================================================
// 모드별 출제
// ============================================================
function askLocation(loc){
  const info=MODE_INFO[G.mode];
  const descForm=loc.descOnly||(loc.fact&&loc.fact.length>=18&&Math.random()<0.65);
  const imageForm=!!loc.image&&(loc.imageOnly||loc.descOnly||Math.random()<0.45);
  const qb=$('question-box'),cb=$('choices-box');
  if(descForm){
    const descText=maskName(loc.desc||loc.fact,loc);
    const caption=loc.mascotName?`〈마스코트 '${loc.mascotName}'〉`:'〈지자체 캐릭터〉';
    const imageHTML=imageForm?`<div class="mascot-clue"><img src="${escapeAttr(loc.image)}" alt="지자체 캐릭터 이미지" loading="eager"><div class="mascot-cap">${caption}</div></div>`:'';
    if(qb)qb.innerHTML=`<span class="q-region">${regionLabel(loc.region)}</span> ${imageForm?'다음 설명과 캐릭터에 해당하는 지역은? 백지도에서 콕!':'어느 지역일까? 백지도에서 콕! 찍어 보자'}<div class="stat-card" style="font-weight:600">${descText}</div>${imageHTML}`;
  }else{if(qb)qb.innerHTML=`<span class="q-region">${regionLabel(loc.region)}</span> 백지도에서 <b style="color:var(--sea-d);font-size:1.2em">${loc.name}</b> ${loc.accept.length>1?'일대':'(이/가) 속한 시·군'}를 탭하세요!`;}
  if(cb)cb.innerHTML='<div class="map-hint">💡 작으면 확대해서 콕! 가까우면 절반 점수</div>';
  if(G.region!=='전체'&&G.mode!=='daily')dimOtherRegions(G.region);
  fitRegion(loc.region);
  const reveal=()=>{loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));addDot(loc.x,loc.y,5,'loc-dot target-reveal');addLabel(loc.x,loc.y-10,loc.name);};
  const off=onMuniTap((t,e)=>{G.locked=true;stopTimer();const tapped=t.dataset.name,p=svgPoint(e.clientX,e.clientY),d=Math.hypot(p.x-loc.x,p.y-loc.y);
    let correct=false,base=0,head='';const exact=loc.accept.includes(tapped),baseFull=descForm?140:120;
    if(exact){correct=true;base=baseFull;head='🎯 정확해요!';}else if(d<=55){correct=true;base=Math.round(baseFull/2);head=`👍 근접! (${tapped} 탭, 절반 점수)`;t.classList.add('wrong');labelWrongMuni(tapped);}else{head=`❌ 아쉬워요 (${tapped} 탭)`;t.classList.add('wrong');labelWrongMuni(tapped);}
    reveal();const pts=award(correct,base);recordStat(loc.region,correct);logResult(loc.accept[0],exact);
    feedback(correct,head,`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),pts);hudUpdate();afterAnswer();
  });
  startTimer(info.time||18,()=>{if(G.locked)return;G.locked=true;off();reveal();award(false,0);recordStat(loc.region,false);logResult(loc.accept[0],false);feedback(false,'⏰ 아깝다, 시간 초과!',`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),0);hudUpdate();afterAnswer();});
}

function askTheme(item){
  const info=MODE_INFO[G.mode];const{def,loc}=item;const descText=maskName(loc.fact,loc);
  const qb=$('question-box'),cb=$('choices-box');
  if(qb)qb.innerHTML=`<span class="q-region">${def.label}</span> 이 테마에 해당하는 지역을 백지도에서 탭하세요!<div class="stat-card" style="font-weight:600">${descText}</div>`;
  if(cb)cb.innerHTML='<div class="map-hint">💡 전국 지도에서 찾아 탭! 가까우면 절반 점수</div>';
  const reveal=()=>{loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));addDot(loc.x,loc.y,5,'loc-dot target-reveal');addLabel(loc.x,loc.y-10,loc.name);};
  const exp=()=>`${def.label} — <b>${loc.name}</b> · ${loc.fact}`+studyExtra(loc.name);
  const off=onMuniTap((t,e)=>{G.locked=true;stopTimer();const tapped=t.dataset.name,p=svgPoint(e.clientX,e.clientY),d=Math.hypot(p.x-loc.x,p.y-loc.y);
    const exact=loc.accept.includes(tapped);let correct=false,base=0,head='';
    if(exact){correct=true;base=130;head='🎯 정확해요!';}else if(d<=55){correct=true;base=65;head=`👍 근접! (${tapped} 탭, 절반 점수)`;t.classList.add('wrong');labelWrongMuni(tapped);}else{head=`❌ 아쉬워요 (${tapped} 탭)`;t.classList.add('wrong');labelWrongMuni(tapped);}
    reveal();const pts=award(correct,base);recordStat(loc.region,correct);logResult(loc.accept[0],exact);feedback(correct,head,exp(),pts);hudUpdate();afterAnswer();
  });
  startTimer(info.time||30,()=>{if(G.locked)return;G.locked=true;off();reveal();award(false,0);recordStat(loc.region,false);logResult(loc.accept[0],false);feedback(false,'⏰ 아깝다, 시간 초과!',exp(),0);hudUpdate();afterAnswer();});
}

function askThemeMCQ(item){
  const info=MODE_INFO[G.mode];const{def,loc,siblings}=item;
  const answer=loc.name,distract=shuffle((siblings||[]).filter(n=>n!==answer)).slice(0,3),opts=shuffle([answer,...distract]);
  const qb=$('question-box'),box=$('choices-box');
  if(qb)qb.innerHTML=`<span class="q-region">${def.label}</span> 다음 특산물의 주산지로 옳은 지역은?<div class="stat-card" style="font-weight:600">${loc.fact}</div>`;
  if(box)box.innerHTML='';
  const exp=()=>`${def.label} — <b>${answer}</b> · ${loc.fact}`+studyExtra(answer);
  const finish=(correct,head,btn)=>{if(box)box.querySelectorAll('button').forEach(b=>{b.disabled=true;if(b.textContent===answer)b.classList.add('correct');else if(b===btn)b.classList.add('wrong');});const pts=award(correct,120);recordStat(loc.region,correct);logResult(loc.accept[0],correct);feedback(correct,head,exp(),pts);hudUpdate();afterAnswer();};
  opts.forEach(o=>{const b=document.createElement('button');b.className='choice-btn';b.textContent=o;b.onclick=()=>{if(G.locked)return;G.locked=true;stopTimer();finish(o===answer,o===answer?'🎯 정답!':`❌ 아쉬워요 — 정답은 ${answer}`,b);};if(box)box.appendChild(b);});
  startTimer(info.time||30,()=>{if(G.locked)return;G.locked=true;finish(false,'⏰ 아깝다, 시간 초과!',null);});
}

function bingoLabel(muni){return muni.replace(/\(.+\)$/,'').replace(/(특별자치시|특별시|광역시)$/,'');}
function buildBingo(){
  const seen=new Set(),uniq=[];
  shuffle(locPool().slice()).forEach(l=>{const k=l.accept&&l.accept[0];if(!k||seen.has(k))return;const raw=l.desc||l.fact;if(!raw)return;seen.add(k);uniq.push({region:l.region,name:bingoLabel(k),accept:l.accept,raw,clue:maskName(raw,l),done:false});});
  return uniq.slice(0,25);
}
function renderBingoGrid(){
  const box=$('choices-box');if(!box)return;
  box.innerHTML='<div class="bingo-grid" id="bingo-grid"></div>';
  const grid=$('bingo-grid');if(!grid)return;
  G.bingo.cells.forEach((cell,i)=>{const b=document.createElement('button');b.className='bingo-cell';b.dataset.i=i;b.innerHTML=`<span>${cell.name}</span>`;b.onclick=()=>bingoTap(i);grid.appendChild(b);});
}
function bingoCellEl(i){return document.querySelector(`.bingo-cell[data-i="${i}"]`);}
function bingoLines(){
  const c=G.bingo.cells,done=i=>c[i].done,lines=[];
  for(let r=0;r<5;r++)lines.push(['R'+r,[0,1,2,3,4].map(k=>r*5+k)]);
  for(let k=0;k<5;k++)lines.push(['C'+k,[0,1,2,3,4].map(r=>r*5+k)]);
  lines.push(['D0',[0,6,12,18,24]]);lines.push(['D1',[4,8,12,16,20]]);
  let neu=0;lines.forEach(([key,idxs])=>{if(idxs.every(done)&&!G.bingo.lineKeys.has(key)){G.bingo.lineKeys.add(key);neu++;idxs.forEach(i=>bingoCellEl(i)?.classList.add('line'));}});return neu;
}
function askBingo(cell){
  const info=MODE_INFO.bingo;G.bingo.targetIdx=G.bingo.cells.indexOf(cell);
  const qb=$('question-box');if(qb)qb.innerHTML=`<span class="q-region">${regionLabel(cell.region)}</span> 설명에 맞는 지역을 빙고판에서 탭!<span class="bingo-strike">❌ ${G.bingo.wrong}/2</span><div class="stat-card" style="font-weight:600">${cell.clue}</div>`;
  startTimer(info.time||22,()=>{if(G.locked)return;G.locked=true;bingoResolve(false,-1);});
}
function bingoTap(i){if(G.locked)return;if(G.bingo.cells[i].done&&i!==G.bingo.targetIdx)return;G.locked=true;stopTimer();bingoResolve(i===G.bingo.targetIdx,i);}
function bingoResolve(correct,tappedIdx){
  const ti=G.bingo.targetIdx,target=G.bingo.cells[ti];let head,pts=0;
  if(correct){target.done=true;bingoCellEl(ti)?.classList.add('done');pts=award(true,90);const nl=bingoLines();if(nl>0){const bonus=50*nl;G.score+=bonus;pts+=bonus;scorePop(bonus);}head=`🎯 정답! ${target.name}`+(nl>0?` · 🎉 빙고 ${nl}줄! +${50*nl}`:'');}
  else{G.bingo.wrong++;if(tappedIdx>=0)bingoCellEl(tappedIdx)?.classList.add('miss-pick');bingoCellEl(ti)?.classList.add('target');pts=award(false,0);head=tappedIdx<0?`⏰ 시간 초과! 정답은 ${target.name}`:`❌ 오답! 정답은 ${target.name}`;}
  recordStat(target.region,correct);logResult(target.accept[0],correct);
  const sc=document.querySelector('.bingo-strike');if(sc)sc.textContent=`❌ ${G.bingo.wrong}/2`;
  feedback(correct,head,`<b>${target.name}</b> · ${target.raw}`+studyExtra(target.name),pts);hudUpdate();
  if(G.bingo.wrong>=2&&!correct){G.idx++;const bn=$('btn-next');if(bn)bn.classList.add('hidden');setTimeout(()=>endGame(),1500);}else afterAnswer();
}

function buildHints(loc){
  const muniName=loc.accept[0].replace(/\(.+\)$/,'');
  const kind=muniName.endsWith('군')?'군(郡)':muniName.match(/(광역시|특별시|특별자치시)$/)?'광역 도시':'도시';
  const prov=MUNIS[loc.accept[0]]?.prov||'';const h1=`${loc.region} 지방의 ${kind}`;
  const masked=maskName(loc.desc||loc.fact,loc);const parts=splitFact(masked).filter(s=>s.length>=4);
  let h2,h3;
  if(parts.length>=2){h2=parts[0];h3=parts.slice(1).join(', ');}
  else{const words=masked.split(' ');if(words.length>=4){const cut=Math.ceil(words.length/2);h2=words.slice(0,cut).join(' ')+' …';h3=masked;}else{h2=masked;h3=masked;}}
  return[h1,h2,h3+(prov?` (${prov})`:' ')];
}
function askDetective(loc){
  const info=MODE_INFO[G.mode],hints=buildHints(loc);let revealed=1;const HINT_COST=40,BASE=170;
  const renderQ=()=>{const qb=$('question-box');if(qb)qb.innerHTML=`<span class="q-region">지역 추리</span> 힌트로 지역을 추리해 지도에서 탭하세요! <span class="map-hint">힌트를 아낄수록 +점수</span><ol class="hint-list">${hints.slice(0,revealed).map(h=>`<li>${h}</li>`).join('')}</ol>`;};
  renderQ();
  const renderChoices=()=>{const cb=$('choices-box');if(!cb)return;cb.innerHTML='';if(revealed<hints.length){const b=document.createElement('button');b.className='ghost-btn hint-btn';b.textContent=`💡 힌트 ${revealed+1} 열기 (-${HINT_COST}점)`;b.onclick=()=>{if(G.locked)return;revealed++;renderQ();renderChoices();};cb.appendChild(b);}else{cb.innerHTML='<div class="map-hint">모든 힌트 공개! 이제 지도를 탭하세요</div>';}};
  renderChoices();if(G.region!=='전체'&&G.mode!=='daily')dimOtherRegions(G.region);fitRegion(loc.region);
  const reveal=()=>{loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));addDot(loc.x,loc.y,5,'loc-dot target-reveal');addLabel(loc.x,loc.y-10,loc.name);};
  const expBody=()=>`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name.replace(/\(.+\)$/,''));
  const handler=e=>{if(suppressTap||G.locked)return;const t=e.target.closest('.muni');if(!t)return;G.locked=true;clearMapTap();stopTimer();
    const tapped=t.dataset.name,p=svgPoint(e.clientX,e.clientY),d=Math.hypot(p.x-loc.x,p.y-loc.y);const baseFull=Math.max(60,BASE-(revealed-1)*HINT_COST);
    let correct=false,base=0,head='';const exact=loc.accept.includes(tapped);
    if(exact){correct=true;base=baseFull;head=`🕵️ 명추리! (힌트 ${revealed}개)`;}else if(d<=55){correct=true;base=Math.round(baseFull/2);head=`👍 근접! (${tapped} 탭, 절반 점수)`;t.classList.add('wrong');labelWrongMuni(tapped);}else{head=`❌ 아쉬워요 (${tapped} 탭)`;t.classList.add('wrong');labelWrongMuni(tapped);}
    reveal();const pts=award(correct,base);recordStat(loc.region,correct);logResult(loc.accept[0],exact);feedback(correct,head,expBody(),pts);hudUpdate();afterAnswer();};
  setMapTap(handler);
  startTimer(info.time||40,()=>{if(G.locked)return;G.locked=true;clearMapTap();reveal();award(false,0);recordStat(loc.region,false);logResult(loc.accept[0],false);feedback(false,'⏰ 아깝다, 시간 초과!',expBody(),0);hudUpdate();afterAnswer();});
}

function askMuniName(name){
  const info=MODE_INFO[G.mode],m=MUNIS[name];
  const qb=$('question-box');if(qb)qb.innerHTML=`<span class="q-region">${m.region}</span> 지도에 <b style="color:var(--accent)">깜빡이는 시·군</b>의 이름은? <span class="map-hint">(${m.prov})</span>`;
  muniEl(name)?.classList.add('flash','pulse');
  if(G.region!=='전체'&&G.mode!=='daily')dimOtherRegions(G.region);
  const bb=muniBBox(name);fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}],Math.max(bb.w,bb.h)*0.9+40);
  const sib=shuffle(Object.keys(MUNIS).filter(n=>n!==name&&MUNIS[n].prov===m.prov));
  let opts=sib.slice(0,3);if(opts.length<3)opts=opts.concat(shuffle(Object.keys(MUNIS).filter(n=>n!==name&&!opts.includes(n))).slice(0,3-opts.length));
  const choices=shuffle([name,...opts]);
  const box=$('choices-box');if(!box)return;box.innerHTML='<div class="choices-grid2"></div>';const grid=box.firstChild;
  choices.forEach(n=>{const b=document.createElement('button');b.className='choice-btn';b.textContent=n.replace(/\(.+\)$/,'');b.dataset.n=n;
    b.onclick=()=>{if(G.locked)return;G.locked=true;stopTimer();grid.querySelectorAll('button').forEach(x=>x.disabled=true);const correct=n===name;b.classList.add(correct?'correct':'wrong');if(!correct)grid.querySelectorAll('button').forEach(x=>{if(x.dataset.n===name)x.classList.add('correct');});
      muniEl(name)?.classList.remove('pulse');muniEl(name)?.classList.add('correct');if(correct)muniEl(name)?.classList.add('hit');const pts=award(correct,100);recordStat(m.region,correct);logResult(name,correct);feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`<b>${name}</b> (${m.prov})`+studyExtra(name.replace(/\(.+\)$/,'')),pts);hudUpdate();afterAnswer();};
    grid.appendChild(b);});
  startTimer(info.time||15,()=>{if(G.locked)return;G.locked=true;grid.querySelectorAll('button').forEach(x=>{x.disabled=true;if(x.dataset.n===name)x.classList.add('correct');});muniEl(name)?.classList.remove('pulse');muniEl(name)?.classList.add('correct');award(false,0);recordStat(m.region,false);logResult(name,false);feedback(false,'⏰ 아깝다, 시간 초과!',`<b>${name}</b> (${m.prov})`,0);hudUpdate();afterAnswer();});
}


// ============================================================
// 기후 / 통계 비교
// ============================================================
const CLIM_INDS={tavg:{label:'연평균 기온',unit:'℃'},tmin:{label:'최한월 평균 기온',unit:'℃'},tmax:{label:'최난월 평균 기온',unit:'℃'},range:{label:'기온의 연교차',unit:'℃'},total:{label:'연 강수량',unit:'mm'},sRate:{label:'여름 강수 집중률',unit:'%'},wRate:{label:'겨울 강수 집중률',unit:'%'}};
const STAT_INDS={pop2020:{label:'총인구(2020)',unit:'만 명',scale:1e-4},popGrow:{label:'1970년 대비 인구 배율',unit:'배',scale:1},farms:{label:'농가 수(2023)',unit:'만 가구',scale:1e-4},riceHa:{label:'벼 재배 면적',unit:'천 ha',scale:1e-3},fruitHa:{label:'과수 재배 면적',unit:'천 ha',scale:1e-3},vegHa:{label:'채소 재배 면적',unit:'천 ha',scale:1e-3},mfgShip:{label:'제조업 출하액',unit:'조 원',scale:1},mfgWorkers:{label:'제조업 종사자',unit:'만 명',scale:1e-4},foreign:{label:'외국인 주민',unit:'만 명',scale:1e-4}};
function climateIndicators(st){const tmin=Math.min(...st.t),tmax=Math.max(...st.t),total=st.p.reduce((a,b)=>a+b,0);const summer=st.p[5]+st.p[6]+st.p[7],winter=st.p[11]+st.p[0]+st.p[1];return{tmin,tmax,range:+(tmax-tmin).toFixed(1),total:Math.round(total),sRate:Math.round(summer/total*100),wRate:Math.round(winter/total*100)};}
function climVal(st,key){const ind=climateIndicators(st);return key==='tavg'?+(st.t.reduce((a,b)=>a+b,0)/12).toFixed(1):ind[key];}
function statVal(sd,key){if(key==='popGrow')return sd.pop1970?+(sd.pop2020/sd.pop1970).toFixed(1):null;const m=STAT_INDS[key];return+(sd[key]*m.scale).toFixed(sd[key]*m.scale>=100?0:1);}
function shortSido(n){return n.replace(/(특별자치시|특별자치도|광역시|특별시)$/,'');}

function renderClimateSVG(st){
  const W=340,H=210,L=38,R=44,T=14,B=24,pw=W-L-R,ph=H-T-B;
  const pMax=Math.max(450,Math.ceil(Math.max(...st.p)/50)*50),tLo=-30,tHi=30;
  const x=i=>L+pw*(i+0.5)/12,yT=v=>T+ph*(1-(v-tLo)/(tHi-tLo)),yP=v=>T+ph*(1-v/pMax);
  let bars='',line='',dots='',gridT='';
  st.p.forEach((v,i)=>{const bw=pw/12*0.62;bars+=`<rect x="${(x(i)-bw/2).toFixed(1)}" y="${yP(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H-B-yP(v)).toFixed(1)}" fill="#5BB8F0" opacity=".85"/>`;});
  line='<polyline fill="none" stroke="#E2574C" stroke-width="2" points="'+st.t.map((v,i)=>`${x(i).toFixed(1)},${yT(v).toFixed(1)}`).join(' ')+'"/>';
  st.t.forEach((v,i)=>{dots+=`<circle cx="${x(i).toFixed(1)}" cy="${yT(v).toFixed(1)}" r="2.4" fill="#E2574C"/>`;});
  [-20,-10,0,10,20].forEach(v=>{gridT+=`<line x1="${L}" y1="${yT(v)}" x2="${W-R}" y2="${yT(v)}" stroke="#D8E8F2" stroke-width="${v===0?1.2:.6}"/><text x="${L-5}" y="${yT(v)+3}" text-anchor="end" font-size="8" fill="#6E93AE">${v}</text>`;});
  let gridP='';for(let v=100;v<pMax;v+=100)gridP+=`<text x="${W-R+5}" y="${(yP(v)+3).toFixed(1)}" font-size="8" fill="#6E93AE">${v}</text>`;
  const months=[1,3,5,7,9,11].map(m=>`<text x="${x(m-1).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="8" fill="#6E93AE">${m}월</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">${gridT}${gridP}${bars}${line}${dots}${months}<text x="${L-5}" y="${T-3}" font-size="8" fill="#E2574C">기온(℃)</text><text x="${W-R+5}" y="${T-3}" font-size="8" fill="#1278C2">강수량(mm)</text><line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#A9CDE3" stroke-width="1"/></svg>`;
}
function renderDualClimate(stA,stB,labels){labels=labels||['(가)','(나)'];return`<div class="dual-climate"><div><div class="dual-label">${labels[0]}</div>${renderClimateSVG(stA)}</div><div><div class="dual-label">${labels[1]}</div>${renderClimateSVG(stB)}</div></div>`;}
function renderPairTable(rows,metas,labels){labels=labels||['(가)','(나)'];const tr=metas.map((m,mi)=>`<tr><td>${m.label}(${m.unit})</td><td>${rows[0].v[mi]}</td><td>${rows[1].v[mi]}</td></tr>`).join('');return`<table class="pair-table"><thead><tr><th>구분</th><th>${labels[0]}</th><th>${labels[1]}</th></tr></thead><tbody>${tr}</tbody></table>`;}
function renderPairBars(rows,metas,labels){
  labels=labels||['(가)','(나)'];const W=330,H=46+metas.length*58;let body='';
  metas.forEach((m,mi)=>{const v=[rows[0].v[mi],rows[1].v[mi]],max=Math.max(...v.map(Math.abs),1e-9),y0=40+mi*58;
    body+=`<text x="10" y="${y0}" font-size="10" font-weight="700" fill="#1B4F8F">${m.label}(${m.unit})</text>`;
    v.forEach((val,i)=>{const bw=Math.max(6,Math.abs(val)/max*180),y=y0+8+i*18;body+=`<text x="10" y="${y+11}" font-size="10" font-weight="800" fill="#2C4A66">${labels[i]}</text><rect x="38" y="${y}" width="${bw.toFixed(1)}" height="13" rx="4" fill="${i===0?'#20A2EE':'#A4CE4E'}"/><text x="${(42+bw).toFixed(1)}" y="${y+11}" font-size="10" fill="#6E93AE">${val}</text>`;});});
  return`<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg"><text x="10" y="18" font-size="9" fill="#98B9CE">자료 비교</text>${body}</svg>`;
}
function renderScatterSVG(rows,m1,m2,labels){
  const W=320,H=230,L=52,R=16,T=18,B=40;const xs=rows.map(r=>r.v1),ys=rows.map(r=>r.v2);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const px=v=>L+(W-L-R)*((v-x0)/((x1-x0)||1)*0.8+0.1),py=v=>T+(H-T-B)*(1-((v-y0)/((y1-y0)||1)*0.8+0.1));
  labels=labels||['(가)','(나)','(다)'];let pts='';
  rows.forEach((r,i)=>{pts+=`<circle cx="${px(r.v1).toFixed(1)}" cy="${py(r.v2).toFixed(1)}" r="5.5" fill="#1278C2" stroke="#fff" stroke-width="1.5"/><text x="${px(r.v1).toFixed(1)}" y="${(py(r.v2)-10).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#1B4F8F">${labels[i]}</text>`;});
  return`<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg"><line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#A9CDE3"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H-B}" stroke="#A9CDE3"/><text x="${(L+W-R)/2}" y="${H-12}" text-anchor="middle" font-size="10" fill="#6E93AE">${m1.label}(${m1.unit}) →</text><text x="14" y="${(T+H-B)/2}" font-size="10" fill="#6E93AE" transform="rotate(-90 14 ${(T+H-B)/2})" text-anchor="middle">${m2.label}(${m2.unit}) →</text>${pts}</svg>`;
}
function renderPopChange(seriesA,seriesB,labels){
  labels=labels||['(가)','(나)'];const W=330,H=200,L=38,R=14,T=18,B=34,years=POP_SERIES_YEARS,all=seriesA.concat(seriesB);
  const ymax=Math.max(200,Math.ceil(Math.max(...all)/50)*50);const x=i=>L+(W-L-R)*i/(years.length-1),y=v=>T+(H-T-B)*(1-v/ymax);
  let grid='';for(let v=0;v<=ymax;v+=50)grid+=`<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W-R}" y2="${y(v).toFixed(1)}" stroke="#D8E8F2" stroke-width="${v===100?1.4:.6}" ${v===100?'':'stroke-dasharray="3 3"'}/><text x="${L-5}" y="${(y(v)+3).toFixed(1)}" text-anchor="end" font-size="8" fill="#6E93AE">${v}</text>`;
  const months=[0,3,6,9].map(i=>`<text x="${x(i).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="8" fill="#6E93AE">${"'"+String(years[i]).slice(2)}</text>`).join('');
  const line=(s,col)=>`<polyline fill="none" stroke="${col}" stroke-width="2.4" points="${s.map((v,i)=>x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ')}"/>`+s.map((v,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="${col}"/>`).join('');
  const endLbl=(s,col,txt)=>`<text x="${(W-R-2).toFixed(1)}" y="${(y(s[s.length-1])-4).toFixed(1)}" text-anchor="end" font-size="10" font-weight="800" fill="${col}">${txt}</text>`;
  return`<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">${grid}${months}${line(seriesA,'#1278C2')}${line(seriesB,'#E2574C')}${endLbl(seriesA,'#1278C2',labels[0])}${endLbl(seriesB,'#E2574C',labels[1])}<text x="${L}" y="${T-6}" font-size="8" fill="#6E93AE">2010=100 상댓값</text></svg>`;
}

const MARK_L=['A','B','C'];
function sortMarkers(arr,xy){return arr.slice().sort((a,b)=>{const A=xy(a),B=xy(b);if(Math.abs(A.x-B.x)>=45)return A.x-B.x;return A.y-B.y;});}
function cmpWord(key,meta){if(key==='range'||key==='popGrow')return'크다';if(meta.unit==='℃'||meta.unit==='%')return'높다';return'많다';}
function pairStatements(valsA,valsB,keys,metaOf){
  const cands=[];keys.forEach((k,ki)=>{const a=valsA[ki],b=valsB[ki];if(a==null||b==null)return;const diff=Math.abs(a-b),base=Math.max(Math.abs(a),Math.abs(b),1e-9);if(diff/base<0.07&&diff<0.7)return;const m=metaOf(k),w=cmpWord(k,m);cands.push({text:`A는 B보다 ${m.label}이(가) ${w}.`,truth:a>b});cands.push({text:`B는 A보다 ${m.label}이(가) ${w}.`,truth:b>a});});
  const trues=shuffle(cands.filter(c=>c.truth)),falses=shuffle(cands.filter(c=>!c.truth));
  if(!trues.length||falses.length<3)return null;return shuffle([trues[0],...falses.slice(0,3)]);
}

function askClimate(item){if(item.kind==='order')return askClimateOrder(item.set);return askClimateMatch(item.set);}
function askClimateMatch(set){
  const info=MODE_INFO[G.mode];
  const pick=shuffle(set.st.slice()).slice(0,2).map(n=>CLIMATE.find(c=>c.name===n));
  const markers=sortMarkers(pick,s=>({x:s.x,y:s.y}));
  const gOrder=[0,1].sort((a,b)=>climVal(markers[a],set.inds[0])-climVal(markers[b],set.inds[0]));
  const metas=set.inds.map(k=>CLIM_INDS[k]);
  markers.forEach((s,i)=>addMatchMark(s.x,s.y,MARK_L[i]));fitViewTo(markers,95);
  const chartLabels=['(가)','(나)'],chartRows=gOrder.map(mi=>({v:set.inds.map(k=>climVal(markers[mi],k))}));
  const ct=['dual','table','bars','scatter'][Math.floor(Math.random()*4)];let chart;
  if(ct==='dual')chart=renderDualClimate(markers[gOrder[0]],markers[gOrder[1]],chartLabels);
  else if(ct==='table')chart=renderPairTable(chartRows,metas,chartLabels);
  else if(ct==='bars')chart=renderPairBars(chartRows,metas,chartLabels);
  else chart=renderScatterSVG(chartRows.map(r=>({v1:r.v[0],v2:r.v[1]})),metas[0],metas[1],chartLabels);
  const expBody=()=>`A: ${markers[0].name} · B: ${markers[1].name}<div class="fb-extra">📌 ${set.point}</div>`;
  const revealNames=()=>{document.querySelectorAll('#map-svg .match-mark').forEach(g=>g.remove());markers.forEach(s=>{addDot(s.x,s.y,5,'loc-dot target-reveal');addLabel(s.x,s.y-10,s.name);});};
  const target=markers[gOrder[0]];
  const qb=$('question-box'),cb=$('choices-box');
  if(qb)qb.innerHTML=`<span class="q-region">기후 비교</span> 자료의 <b style="color:var(--sea-d)">(가)</b>에 해당하는 지역을 지도의 A·B에서 탭하세요!${chart}<div class="map-hint">1991~2020년 평년값 · 위치(위도·해안/내륙·고도)로 판단!</div>`;
  if(cb)cb.innerHTML='';
  const handler=e=>{if(suppressTap||G.locked)return;const p=svgPoint(e.clientX,e.clientY),d0=Math.hypot(p.x-markers[0].x,p.y-markers[0].y),d1=Math.hypot(p.x-markers[1].x,p.y-markers[1].y),tapped=d0<=d1?0:1;G.locked=true;clearMapTap();stopTimer();const ok=markers[tapped]===target;revealNames();const pts=award(ok,90);pick.forEach(s=>recordStat(s.region,ok));feedback(ok,ok?'정답':`오답 (탭: ${MARK_L[tapped]})`,`(가)는 <b>${MARK_L[markers.indexOf(target)]} ${target.name}</b> · `+expBody(),pts);hudUpdate();afterAnswer();};
  setMapTap(handler);
  startTimer(28,()=>{if(G.locked)return;G.locked=true;clearMapTap();revealNames();award(false,0);pick.forEach(s=>recordStat(s.region,false));feedback(false,'시간 초과',`(가)는 <b>${target.name}</b> · `+expBody(),0);hudUpdate();afterAnswer();});
}
function askClimateOrder(set){
  const sts=set.st.map(n=>CLIMATE.find(c=>c.name===n)),m=CLIM_INDS[set.ind];
  const sorted=sts.slice().sort((a,b)=>climVal(b,set.ind)-climVal(a,set.ind)),correct=sorted.map(s=>s.name).join(' > ');
  const qb=$('question-box'),box=$('choices-box');
  if(qb)qb.innerHTML=`<span class="q-region">기후 비교</span> 다음 세 지역을 <b style="color:var(--accent-l)">${m.label}</b>이(가) 큰 지역부터 순서대로 나열한 것은?<div class="stat-card" style="text-align:center;font-weight:700">${shuffle(sts.slice()).map(s=>s.name).join(' · ')}</div><div class="map-hint">위치(위도·내륙/해안·고도)를 떠올리며 상대 비교!</div>`;
  const PERMS3=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  let perms=shuffle(PERMS3).slice(0,5);if(!perms.some(p=>p.map(i=>sts[i].name).join(' > ')===correct)){perms[0]=sorted.map(s=>sts.indexOf(s));perms=shuffle(perms);}
  const expBody=`${sorted.map(s=>`${s.name} ${climVal(s,set.ind)}${m.unit}`).join(' > ')}<div class="fb-extra">📌 ${set.point}</div>`;
  if(box)box.innerHTML='';
  perms.forEach(p=>{const txt=p.map(i=>sts[i].name).join(' > ');const b=document.createElement('button');b.className='choice-btn';b.textContent=txt;b.dataset.t=txt;
    b.onclick=()=>{if(G.locked)return;G.locked=true;stopTimer();if(box)box.querySelectorAll('button').forEach(x=>x.disabled=true);const ok=txt===correct;b.classList.add(ok?'correct':'wrong');if(!ok&&box)box.querySelectorAll('button').forEach(x=>{if(x.dataset.t===correct)x.classList.add('correct');});const pts=award(ok,110);sts.forEach(s=>recordStat(s.region,ok));feedback(ok,ok?'정답':'오답',expBody,pts);hudUpdate();afterAnswer();};
    if(box)box.appendChild(b);});
  startTimer(MODE_INFO[G.mode].time||25,()=>{if(G.locked)return;G.locked=true;if(box)box.querySelectorAll('button').forEach(x=>{x.disabled=true;if(x.dataset.t===correct)x.classList.add('correct');});award(false,0);sts.forEach(s=>recordStat(s.region,false));feedback(false,'시간 초과',expBody,0);hudUpdate();afterAnswer();});
}

let PROV_CENTER=null;
function provCenter(name){
  if(!PROV_CENTER){PROV_CENTER={};const acc={};for(const[n,m]of Object.entries(MUNIS)){(acc[m.prov]=acc[m.prov]||[]).push([m.cx,m.cy]);}for(const[p,pts]of Object.entries(acc)){PROV_CENTER[p]={x:pts.reduce((a,b)=>a+b[0],0)/pts.length,y:pts.reduce((a,b)=>a+b[1],0)/pts.length};}}
  return PROV_CENTER[name];
}
function askStats(set){
  const info=MODE_INFO[G.mode];const pick=shuffle(set.sd.slice()).slice(0,2).map(n=>SIDO_STATS.find(s=>s.name===n));
  const markers=sortMarkers(pick,s=>provCenter(s.name));const gOrder=[0,1].sort((a,b)=>statVal(markers[a],set.inds[0])-statVal(markers[b],set.inds[0]));const metas=set.inds.map(k=>STAT_INDS[k]);
  const target=new Set(markers.map(s=>s.name));
  document.querySelectorAll('#map-svg .muni').forEach(x=>{if(!target.has(x.dataset.prov))x.classList.add('dim-region');});
  markers.forEach((s,i)=>{const c=provCenter(s.name);addMatchMark(c.x,c.y,MARK_L[i]);});
  const canPop=markers.every(s=>s.popSeries)&&Math.abs(markers[0].popSeries[9]-markers[1].popSeries[9])>=12;
  const usePop=canPop&&Math.random()<0.5;const order=usePop?[0,1].sort((a,b)=>markers[a].popSeries[9]-markers[b].popSeries[9]):gOrder;
  const chartLabels=['(가)','(나)'];let chart;
  if(usePop){chart=renderPopChange(markers[order[0]].popSeries,markers[order[1]].popSeries,chartLabels);}
  else{const chartRows=order.map(mi=>({v:set.inds.map(k=>statVal(markers[mi],k))}));const ct=['table','bars','scatter'][Math.floor(Math.random()*3)];if(ct==='table')chart=renderPairTable(chartRows,metas,chartLabels);else if(ct==='bars')chart=renderPairBars(chartRows,metas,chartLabels);else chart=renderScatterSVG(chartRows.map(r=>({v1:r.v[0],v2:r.v[1]})),metas[0],metas[1],chartLabels);}
  const expBody=()=>`A: ${shortSido(markers[0].name)} · B: ${shortSido(markers[1].name)}<div class="fb-extra">📌 ${set.point}</div>`;
  const revealNames=()=>{document.querySelectorAll('#map-svg .match-mark').forEach(g=>g.remove());markers.forEach(s=>{const c=provCenter(s.name);addLabel(c.x,c.y+4,shortSido(s.name));});};
  const targetSd=markers[order[0]];
  const qb=$('question-box'),cb=$('choices-box');
  if(qb)qb.innerHTML=`<span class="q-region">통계 비교</span> 자료의 <b style="color:var(--sea-d)">(가)</b>에 해당하는 시·도를 지도의 A·B에서 탭하세요!${chart}<div class="map-hint">${usePop?'인구 변화 그래프(2010=100) — 증가/감소 추세로 판단!':'통계청 자료 — 산업·인구의 지역 차로 판단!'} (A·B 시·도만 탭 가능)</div>`;
  if(cb)cb.innerHTML='';
  const handler=e=>{if(suppressTap||G.locked)return;const t=e.target.closest('.muni');if(!t||!target.has(t.dataset.prov))return;G.locked=true;clearMapTap();stopTimer();const ok=t.dataset.prov===targetSd.name;revealNames();const pts=award(ok,90);pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,ok));feedback(ok,ok?'정답':`오답 (탭: ${shortSido(t.dataset.prov)})`,`(가)는 <b>${shortSido(targetSd.name)}</b> · `+expBody(),pts);hudUpdate();afterAnswer();};
  setMapTap(handler);
  startTimer(28,()=>{if(G.locked)return;G.locked=true;clearMapTap();revealNames();award(false,0);pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,false));feedback(false,'시간 초과',`(가)는 <b>${shortSido(targetSd.name)}</b> · `+expBody(),0);hudUpdate();afterAnswer();});
}

function askMCQ(q){
  const info=MODE_INFO[G.mode];const qb=$('question-box'),box=$('choices-box');
  if(qb)qb.innerHTML=`<span class="q-region">${q.region}</span> ${q.q}`;if(box)box.innerHTML='';
  const order=shuffle(q.choices.map((_,i)=>i));
  order.forEach(i=>{const b=document.createElement('button');b.className='choice-btn';b.innerHTML=q.choices[i];b.dataset.i=i;
    b.onclick=()=>{if(G.locked)return;G.locked=true;stopTimer();if(box)box.querySelectorAll('button').forEach(x=>x.disabled=true);const correct=i===q.answer;b.classList.add(correct?'correct':'wrong');if(!correct&&box)box.querySelectorAll('button').forEach(x=>{if(x.dataset.i==q.answer)x.classList.add('correct');});const pts=award(correct,100);recordStat(q.region,correct);feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`💡 ${q.exp}`,pts);hudUpdate();afterAnswer();};
    if(box)box.appendChild(b);});
  startTimer(info.time||25,()=>{if(G.locked)return;G.locked=true;if(box)box.querySelectorAll('button').forEach(x=>{x.disabled=true;if(x.dataset.i==q.answer)x.classList.add('correct');});award(false,0);recordStat(q.region,false);feedback(false,'⏰ 아깝다, 시간 초과!',`💡 ${q.exp}`,0);hudUpdate();afterAnswer();});
}
function askOX(q){
  const qb=$('question-box'),box=$('choices-box');if(qb)qb.innerHTML=`<span class="q-region">${q.region}</span> ${q.q}`;if(box)box.innerHTML='<div class="ox-row"></div>';
  const row=box?.firstChild;
  [['⭕',true],['❌',false]].forEach(([label,val])=>{const b=document.createElement('button');b.className='choice-btn';b.textContent=label;b.onclick=()=>{if(G.locked)return;G.locked=true;stopTimer();if(row)row.querySelectorAll('button').forEach(x=>x.disabled=true);const correct=val===q.answer;b.classList.add(correct?'correct':'wrong');const pts=award(correct,70);recordStat(q.region,correct);feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`정답: ${q.answer?'O':'X'} — ${q.exp}`,pts);hudUpdate();afterAnswer();};if(row)row.appendChild(b);});
  const sec=G.mode==='ox'?Math.min(8,(G.oxEnd-Date.now())/1000):9;
  startTimer(Math.max(1,sec),()=>{if(G.locked)return;G.locked=true;if(row)row.querySelectorAll('button').forEach(x=>x.disabled=true);award(false,0);recordStat(q.region,false);if(G.mode==='ox'&&Date.now()>=G.oxEnd)return endGame();feedback(false,'⏰ 아깝다, 시간 초과!',`정답: ${q.answer?'O':'X'} — ${q.exp}`,0);hudUpdate();afterAnswer();});
}


// ============================================================
// 탐색 모드
// ============================================================
const EXP={list:[],i:-1};
function startExplore(){
  show('screen-game');
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>{const el=$(id);if(el&&el.parentElement)el.parentElement.style.visibility='hidden';});
  const tbar=$('timer-bar');if(tbar)tbar.style.width='0%';
  const qb=$('question-box');if(qb)qb.innerHTML='<span class="q-region">학습 모드</span> 지도에서 시·군을 탭하거나, ◀ ▶ 로 지역을 넘겨 보세요.';
  const box=$('choices-box');if(!box)return;
  box.innerHTML='<div class="explore-controls" id="exp-chips"></div><div id="exp-info" class="exp-info">지역을 선택하면 핵심 정보가 여기에 표시됩니다.</div>';
  const chipBox=$('exp-chips');
  ['전체',...MAP_REGIONS].forEach(r=>{const b=document.createElement('button');b.className='chip'+(r==='전체'?' on':'');b.textContent=regionLabel(r);b.onclick=()=>{chipBox.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));b.classList.add('on');renderExploreDots(r);};if(chipBox)chipBox.appendChild(b);});
  renderExploreDots('전체');
  const svg=$('map-svg');if(!svg)return;
  svg.onclick=e=>{if(suppressTap)return;const t=e.target.closest('.muni');if(!t)return;
    const name=t.dataset.name,i=EXP.list.findIndex(l=>l.accept.includes(name));
    if(i>=0){expShow(i);return;}
    document.querySelectorAll('#map-svg .muni').forEach(x=>x.classList.remove('flash'));t.classList.add('flash');
    const bb=muniBBox(name);fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}],Math.max(bb.w,bb.h)*0.8+40);
    const ei=$('exp-info');if(ei)ei.innerHTML=`<div class="exp-head"><b>${name.replace(/\(.+\)$/,'')}</b></div><div class="exp-text">등록된 수능 포인트가 없는 지역 — 경계와 위치만 눈에 익혀 두세요!</div>`+studyExtra(name.replace(/\(.+\)$/,''));
  };
}
function expShow(i){
  const ei=$('exp-info');if(!EXP.list.length||!ei)return;
  EXP.i=(i+EXP.list.length)%EXP.list.length;const l=EXP.list[EXP.i];
  document.querySelectorAll('#map-svg .muni').forEach(x=>x.classList.remove('flash'));
  l.accept.forEach(n=>muniEl(n)?.classList.add('flash'));
  const bb=muniBBox(l.accept[0]);fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}],Math.max(bb.w,bb.h)*0.8+40);
  ei.innerHTML=`<div class="exp-nav"><button class="ghost-btn exp-prev">◀ 이전</button><span class="exp-count">${EXP.i+1} / ${EXP.list.length}</span><button class="ghost-btn exp-next">다음 ▶</button></div>`+
    `<div class="exp-head"><b>${l.name}</b></div><div class="exp-text">${l.fact}</div>`+studyExtra(l.name.replace(/\(.+\)$/,''));
  ei.querySelector('.exp-prev').onclick=()=>expShow(EXP.i-1);
  ei.querySelector('.exp-next').onclick=()=>expShow(EXP.i+1);
  let sx=null;ei.ontouchstart=e=>{sx=e.touches[0].clientX;};ei.ontouchend=e=>{if(sx===null)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>48)expShow(EXP.i+(dx<0?1:-1));};
}
function renderExploreDots(region){
  clearMapExtras();resetView();dimOtherRegions(region==='전체'?'전체':region);
  EXP.list=LOCATIONS.filter(l=>region==='전체'||l.region===region);EXP.i=-1;
  const ei=$('exp-info');if(ei)ei.innerHTML='지역을 선택하거나 ◀ ▶ 로 넘겨 보세요.<div class="exp-nav" style="margin-top:8px"><button class="ghost-btn" onclick="expShow(0)">첫 지역부터 보기 ▶</button></div>';
}

// ============================================================
// 카드 시스템 (원본 동일 — cuteLandSVG 포함)
// ============================================================
const DRAW_COST=5,CARD_MAX_LV=3,ENHANCE_NEED=5;
function cardLevel(name){return cardLv[name]||1;}
function canEnhance(name){return!!cards[name]&&cardLevel(name)<CARD_MAX_LV&&cards[name]>=ENHANCE_NEED;}
function doEnhance(name){if(!canEnhance(name))return false;cards[name]-=(ENHANCE_NEED-1);cardLv[name]=cardLevel(name)+1;store.save('geo_cards',cards);store.save('geo_cardlv',cardLv);updateGachaUI();checkAchievements();return true;}
function starHTML(lv){let s='';for(let i=1;i<=CARD_MAX_LV;i++)s+=`<span class="cstar${i<=lv?' on':''}">★</span>`;return s;}

// 권역 배경색
const REGION_COLORS={
  '수도권':{bg:'#D9EFFD',deep:'#1278C2',map:'#6FB7EC'},
  '강원':  {bg:'#DDF3E1',deep:'#2FA34F',map:'#7FCB8F'},
  '충청':  {bg:'#FFF3C9',deep:'#C77F00',map:'#F6CE5B'},
  '호남':  {bg:'#FFE5E1',deep:'#D8554A',map:'#F08A80'},
  '영남':  {bg:'#EAE4FB',deep:'#6A5ACD',map:'#A795E0'},
  '제주':  {bg:'#FFE9D4',deep:'#E8740C',map:'#F9A86B'},
};

// 도(道) 짧은 이름
const PROV_SHORT={'경기도':'경기','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남','전북특별자치도':'전북','전라남도':'전남','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주'};
function cardDisplayName(loc){const mu=loc.accept[0],prov=MUNIS[mu]?.prov||'',base=loc.name.replace(/\(.+\)$/,''),short=PROV_SHORT[prov];return short?`${short} ${base}`:base;}

// 스탬프 아트 라이브러리
const STAMP_ART={
  tea:`<ellipse cx="35" cy="55" rx="26" ry="14" fill="#2FA34F" transform="rotate(-35 35 55)"/><ellipse cx="68" cy="48" rx="24" ry="13" fill="#5CB531" transform="rotate(25 68 48)"/><path d="M35 55 Q50 30 68 48" stroke="#1F7A38" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  ship:`<path d="M15 62 L85 62 L72 84 L28 84 Z" fill="#1278C2"/><rect x="44" y="34" width="12" height="28" fill="#E2574C"/><rect x="36" y="46" width="28" height="16" rx="3" fill="#fff"/><path d="M8 70 Q18 64 28 70 T48 70 T68 70 T88 70" stroke="#7CC4F0" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  factory:`<rect x="20" y="45" width="60" height="38" rx="4" fill="#8FA6B6"/><rect x="28" y="28" width="12" height="20" fill="#6E93AE"/><rect x="52" y="22" width="12" height="26" fill="#6E93AE"/><circle cx="34" cy="18" r="8" fill="#fff" opacity=".9"/><circle cx="62" cy="12" r="10" fill="#fff" opacity=".8"/><rect x="30" y="56" width="11" height="11" fill="#FFD23F"/><rect x="56" y="56" width="11" height="11" fill="#FFD23F"/>`,
  apple:`<circle cx="50" cy="58" r="26" fill="#E2574C"/><circle cx="40" cy="50" r="8" fill="#FF8E8E" opacity=".8"/><path d="M50 34 Q52 22 62 18" stroke="#7A4E21" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="66" cy="26" rx="12" ry="7" fill="#5CB531" transform="rotate(28 66 26)"/>`,
  grape:`<circle cx="38" cy="46" r="11" fill="#8E7BE5"/><circle cx="60" cy="46" r="11" fill="#7E6CD9"/><circle cx="49" cy="60" r="11" fill="#6A5ACD"/><circle cx="38" cy="73" r="10" fill="#8E7BE5"/><circle cx="60" cy="73" r="10" fill="#7E6CD9"/><path d="M50 36 Q50 22 58 16" stroke="#7A4E21" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="64" cy="22" rx="11" ry="6" fill="#5CB531" transform="rotate(20 64 22)"/>`,
  citrus:`<circle cx="50" cy="58" r="26" fill="#FF9F2E"/><circle cx="41" cy="50" r="7" fill="#FFC97C" opacity=".9"/><ellipse cx="58" cy="30" rx="12" ry="7" fill="#2FA34F" transform="rotate(-18 58 30)"/>`,
  rice:`<path d="M50 84 Q48 52 50 30" stroke="#C7A14A" stroke-width="5" fill="none"/><g fill="#FFD23F" stroke="#C7A14A" stroke-width="2"><ellipse cx="42" cy="34" rx="7" ry="11" transform="rotate(20 42 34)"/><ellipse cx="58" cy="34" rx="7" ry="11" transform="rotate(-20 58 34)"/><ellipse cx="40" cy="50" rx="7" ry="11" transform="rotate(25 40 50)"/><ellipse cx="60" cy="50" rx="7" ry="11" transform="rotate(-25 60 50)"/><ellipse cx="50" cy="22" rx="7" ry="11"/></g>`,
  crab:`<ellipse cx="50" cy="58" rx="24" ry="17" fill="#F08A80"/><circle cx="42" cy="50" r="4.5" fill="#fff"/><circle cx="58" cy="50" r="4.5" fill="#fff"/><circle cx="42" cy="50" r="2.2" fill="#4A3426"/><circle cx="58" cy="50" r="2.2" fill="#4A3426"/><path d="M28 46 Q14 36 18 24 M72 46 Q86 36 82 24" stroke="#E2574C" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="16" cy="22" r="7" fill="#E2574C"/><circle cx="84" cy="22" r="7" fill="#E2574C"/>`,
  snow:`<g stroke="#7CC4F0" stroke-width="6" stroke-linecap="round"><path d="M50 18 V82 M22 34 L78 66 M78 34 L22 66"/></g><circle cx="50" cy="50" r="8" fill="#fff" stroke="#7CC4F0" stroke-width="4"/>`,
  mountain:`<path d="M14 80 L42 32 L60 60 L72 42 L90 80 Z" fill="#2FA34F"/><path d="M42 32 L52 49 L46 49 L54 60 L34 60 L42 46 Z" fill="#fff" opacity=".9"/>`,
  temple:`<path d="M18 46 Q50 18 82 46 L74 46 Q50 28 26 46 Z" fill="#4A6E3A"/><path d="M24 50 H76 L72 44 H28 Z" fill="#8E5A2B"/><rect x="32" y="50" width="36" height="26" fill="#F2E6D0"/><rect x="44" y="56" width="12" height="20" fill="#8E5A2B"/><rect x="28" y="76" width="44" height="7" rx="2" fill="#A8794A"/>`,
  train:`<rect x="22" y="34" width="56" height="38" rx="14" fill="#fff" stroke="#1278C2" stroke-width="5"/><rect x="30" y="42" width="40" height="13" rx="5" fill="#7CC4F0"/><circle cx="38" cy="64" r="5" fill="#1B4F8F"/><circle cx="62" cy="64" r="5" fill="#1B4F8F"/><path d="M22 78 H78" stroke="#9CC8E8" stroke-width="5" stroke-linecap="round"/>`,
  lighthouse:`<path d="M42 30 H58 L62 78 H38 Z" fill="#fff" stroke="#E2574C" stroke-width="4"/><path d="M40 44 H60 M39 58 H61" stroke="#E2574C" stroke-width="7"/><rect x="40" y="18" width="20" height="13" rx="4" fill="#FFD23F"/><path d="M30 84 H70" stroke="#1278C2" stroke-width="6" stroke-linecap="round"/>`,
  ginseng:`<path d="M50 30 Q46 48 50 56 Q40 62 36 78 M50 56 Q60 64 62 80 M50 42 Q42 46 38 42" stroke="#D9B48A" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M50 30 Q44 18 34 16 M50 30 Q56 16 66 14" stroke="#2FA34F" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="14" rx="9" ry="5" fill="#5CB531"/><ellipse cx="68" cy="12" rx="9" ry="5" fill="#5CB531"/>`,
  cheese:`<path d="M16 64 L84 40 L84 76 L16 76 Z" fill="#FFD23F" stroke="#E8B100" stroke-width="3"/><circle cx="42" cy="62" r="6" fill="#FFF3C9"/><circle cx="62" cy="56" r="5" fill="#FFF3C9"/><circle cx="70" cy="68" r="4" fill="#FFF3C9"/>`,
  butterfly:`<g fill="#F2889B"><ellipse cx="34" cy="42" rx="17" ry="14" transform="rotate(-20 34 42)"/><ellipse cx="66" cy="42" rx="17" ry="14" transform="rotate(20 66 42)"/><ellipse cx="36" cy="64" rx="13" ry="11" transform="rotate(15 36 64)" fill="#FF6B9D"/><ellipse cx="64" cy="64" rx="13" ry="11" transform="rotate(-15 64 64)" fill="#FF6B9D"/></g><rect x="46" y="34" width="8" height="40" rx="4" fill="#4A3426"/>`,
  hotspring:`<ellipse cx="50" cy="68" rx="30" ry="14" fill="#7CC4F0"/><path d="M36 50 Q32 40 36 32 M50 52 Q46 40 50 30 M64 50 Q60 40 64 32" stroke="#9CC8E8" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  cow:`<ellipse cx="50" cy="56" rx="26" ry="22" fill="#C68A4F"/><ellipse cx="50" cy="66" rx="13" ry="9" fill="#F2D9BD"/><circle cx="41" cy="48" r="4" fill="#4A3426"/><circle cx="59" cy="48" r="4" fill="#4A3426"/><path d="M26 40 Q18 32 20 24 M74 40 Q82 32 80 24" stroke="#A8794A" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  fish:`<ellipse cx="46" cy="52" rx="26" ry="15" fill="#7CC4F0"/><path d="M70 52 L88 38 L88 66 Z" fill="#5BB8F0"/><circle cx="32" cy="48" r="4" fill="#1B4F8F"/>`,
  garlic:`<path d="M50 26 Q42 36 36 50 Q30 70 50 78 Q70 70 64 50 Q58 36 50 26 Z" fill="#F6F0E4" stroke="#D9CBB0" stroke-width="3"/><path d="M50 26 Q52 16 58 12" stroke="#5CB531" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  cave:`<path d="M20 80 Q20 34 50 30 Q80 34 80 80 Z" fill="#8E7BE5"/><path d="M34 80 Q34 52 50 50 Q66 52 66 80 Z" fill="#3B2F66"/>`,
  volcano:`<path d="M22 78 Q34 42 44 40 L56 40 Q66 42 78 78 Z" fill="#C68A4F"/><ellipse cx="50" cy="40" rx="9" ry="4" fill="#8E5A2B"/>`,
  plane:`<path d="M22 58 L78 42 Q86 40 84 48 L80 52 L40 64 Z" fill="#fff" stroke="#1278C2" stroke-width="4"/><path d="M52 48 L42 30 L52 30 L62 45 Z" fill="#7CC4F0"/>`,
  car:`<path d="M22 62 Q24 48 36 46 L62 44 Q74 44 78 56 L80 62 Q82 70 74 70 H28 Q20 70 22 62 Z" fill="#5BB8F0" stroke="#1278C2" stroke-width="3.5"/><circle cx="36" cy="70" r="7" fill="#1B4F8F"/><circle cx="66" cy="70" r="7" fill="#1B4F8F"/>`,
  chip:`<rect x="30" y="30" width="40" height="40" rx="6" fill="#1B4F8F"/><rect x="40" y="40" width="20" height="20" rx="3" fill="#7CC4F0"/>`,
  building:`<rect x="30" y="26" width="40" height="56" rx="4" fill="#9CC8E8"/><g fill="#FFF3C9"><rect x="37" y="34" width="9" height="9"/><rect x="54" y="34" width="9" height="9"/><rect x="37" y="50" width="9" height="9"/><rect x="54" y="50" width="9" height="9"/></g>`,
};
const STAMP_RULES=[
  [/치즈/,'cheese'],[/녹차|차밭|다향/,'tea'],[/한우|목축|축산/,'cow'],
  [/조선 공업|조선소|항구|항만/,'ship'],[/제철|철강|석유 화학|정유|시멘트/,'factory'],
  [/공항/,'plane'],[/자동차/,'car'],[/반도체|전자|디스플레이|IT/,'chip'],
  [/사과/,'apple'],[/포도|와인|복분자/,'grape'],[/감귤/,'citrus'],
  [/인삼|홍삼/,'ginseng'],[/마늘|양파/,'garlic'],
  [/갯벌|염전|대게|꽃게/,'crab'],[/오징어|산천어|굴비|수산/,'fish'],
  [/동굴|카르스트|석회/,'cave'],[/화산|오름|용암|주상 절리/,'volcano'],
  [/눈|동계|스키/,'snow'],[/온천/,'hotspring'],
  [/청자|도자기/,'pottery'],[/나비|반딧불|생태|습지/,'butterfly'],
  [/불국사|해인사|하회|사찰|향교|서원|한옥|고인돌|왕릉|유적/,'temple'],
  [/KTX|철도|기차/,'train'],[/등대|다도해|섬|도서/,'lighthouse'],
  [/벼|쌀|평야|곡창|간척/,'rice'],[/혁신도시|도청|행정|신도시/,'building'],
  [/국립 공원|산맥|고원|지리산|설악|덕유|소백/,'mountain'],
];
function stampsOf(loc){
  const text=(loc.fact||'')+' '+(loc.name||'');const found=[];
  for(const[re,key]of STAMP_RULES){if(re.test(text)&&!found.includes(key))found.push(key);if(found.length>=2)break;}
  if(!found.length)found.push('mountain');return found;
}
function stampSVG(key,x,y,size,flip){
  const art=STAMP_ART[key]||STAMP_ART.mountain;
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(size/100*(flip?-1:1)).toFixed(4)},${(size/100).toFixed(4)}) translate(-50,-50)">${art}</g>`;
}

// 시·군 실루엣 SVG (map-data.js path 활용)
function cuteLandSVG(mu, withFace, loc, expr){
  const bb=muniBBox(mu),m=MUNIS[mu];
  const s=Math.sqrt(bb.w*bb.h),er=s*0.052,gap=s*0.14;
  const fx=m.cx,fy=m.cy,f=n=>n.toFixed(1);
  let face='';
  if(withFace&&expr==='happy'){
    const L=fx-gap/2,R=fx+gap/2,eye=cx=>`<path d="M ${f(cx-er)} ${f(fy)} Q ${f(cx)} ${f(fy-er*1.35)} ${f(cx+er)} ${f(fy)}" fill="none" stroke="#4A3426" stroke-width="${(er*0.42).toFixed(2)}" stroke-linecap="round"/>`;
    face=`<g class="land-face">${eye(L)}${eye(R)}<ellipse cx="${f(fx-gap*0.98)}" cy="${f(fy+er*1.25)}" rx="${f(er*0.92)}" ry="${f(er*0.58)}" fill="#FF8F7A" opacity=".72"/><ellipse cx="${f(fx+gap*0.98)}" cy="${f(fy+er*1.25)}" rx="${f(er*0.92)}" ry="${f(er*0.58)}" fill="#FF8F7A" opacity=".72"/><path d="M ${f(fx-er*1.15)} ${f(fy+er*0.85)} Q ${f(fx)} ${f(fy+er*2.9)} ${f(fx+er*1.15)} ${f(fy+er*0.85)} Z" fill="#4A3426"/><path d="M ${f(fx-er*0.55)} ${f(fy+er*1.95)} Q ${f(fx)} ${f(fy+er*2.55)} ${f(fx+er*0.55)} ${f(fy+er*1.95)} Z" fill="#FF8F7A"/></g>`;
  }else if(withFace){
    face=`<g class="land-face"><circle cx="${f(fx-gap/2)}" cy="${f(fy)}" r="${er}" fill="#4A3426"/><circle cx="${f(fx+gap/2)}" cy="${f(fy)}" r="${er}" fill="#4A3426"/><circle cx="${f(fx-gap/2+er*0.3)}" cy="${f(fy-er*0.35)}" r="${er*0.32}" fill="#fff"/><circle cx="${f(fx+gap/2+er*0.3)}" cy="${f(fy-er*0.35)}" r="${er*0.32}" fill="#fff"/><ellipse cx="${f(fx-gap*0.95)}" cy="${f(fy+er*1.1)}" rx="${f(er*0.85)}" ry="${f(er*0.5)}" fill="#FF8F7A" opacity=".65"/><ellipse cx="${f(fx+gap*0.95)}" cy="${f(fy+er*1.1)}" rx="${f(er*0.85)}" ry="${f(er*0.5)}" fill="#FF8F7A" opacity=".65"/><path d="M ${f(fx-er*0.9)} ${f(fy+er*1.15)} Q ${f(fx)} ${f(fy+er*2.3)} ${f(fx+er*0.9)} ${f(fy+er*1.15)}" fill="none" stroke="#4A3426" stroke-width="${(er*0.42).toFixed(2)}" stroke-linecap="round"/></g>`;
  }
  let stampG='';
  if(withFace&&loc){const st=stampsOf(loc);stampG+=stampSVG(st[0],fx+s*0.40,fy-s*0.34,s*0.46,false);if(st[1])stampG+=stampSVG(st[1],fx-s*0.42,fy+s*0.34,s*0.36,false);}
  return `<svg viewBox="${bb.x.toFixed(0)} ${bb.y.toFixed(0)} ${bb.w.toFixed(0)} ${bb.h.toFixed(0)}" class="card-sil"><path d="${m.d}" class="land-shadow" vector-effect="non-scaling-stroke"/><path d="${m.d}" class="land" vector-effect="non-scaling-stroke"/>${face}${stampG}</svg>`;
}

function updateGachaUI(){
  const cc=$('coin-cnt');if(cc)cc.innerHTML=`🪙 <b>${coins}</b>`;
  const cp=$('coll-progress');if(cp)cp.textContent=`카드 ${Object.keys(cards).length}/${LOCATIONS.length}장 수집`;
  document.querySelectorAll('[id="btn-draw"]').forEach(b=>{b.disabled=coins<DRAW_COST;});
}
function drawCard(){
  if(coins<DRAW_COST)return null;
  coins-=DRAW_COST;store.save('geo_coins',coins);
  const loc=LOCATIONS[Math.floor(Math.random()*LOCATIONS.length)];
  const dup=!!cards[loc.name];cards[loc.name]=(cards[loc.name]||0)+1;
  if(dup){coins+=2;store.save('geo_coins',coins);}
  store.save('geo_cards',cards);updateGachaUI();missionProgress({isNew:!dup});checkAchievements();
  return{loc,dup};
}
function openGacha(){
  const res=drawCard();if(!res)return;
  const modal=$('gacha-modal');if(!modal)return;
  modal.classList.remove('hidden');
  const card=$('gacha-card');if(card)card.classList.remove('flipped');
  const gf=$('gcard-front');
  if(gf){
    const mu=res.loc.accept[0],rc=REGION_COLORS[res.loc.region]||REGION_COLORS['수도권'];
    gf.innerHTML=`<div class="gacha-sil" style="background:${rc.bg};border-radius:12px;padding:10px">${cuteLandSVG(mu,true,res.loc,'happy')}<div style="text-align:center;font-size:14px;font-weight:800;color:${rc.deep};margin-top:4px">${cardDisplayName(res.loc)}</div><div style="text-align:center;font-size:11px;color:var(--dim);margin-top:2px">${regionLabel(res.loc.region)}</div></div>`;
  }
  const gm=$('gacha-msg');if(gm)gm.innerHTML='';
  setTimeout(()=>{
    if(card)card.classList.add('flipped');
    if(gm)gm.innerHTML=(res.dup?`이미 가진 카드! <b style="color:var(--gold)">+2🪙 환급</b>`:`<b style="color:var(--sea-d)">NEW!</b> 새로운 지역 카드 획득`)+` · 보유 🪙 ${coins}`;
    if(!res.dup)confetti(modal.querySelector('.modal-box'));
    const bda=$('btn-draw-again');if(bda){bda.classList.remove('hidden');bda.disabled=coins<DRAW_COST;}
  },600);
  try{if(navigator.vibrate)navigator.vibrate(res.dup?30:[40,60,40,60,120]);}catch(e){}
}
function renderCollection(filter){
  const grid=$('cards-grid');if(!grid)return;grid.innerHTML='';
  const list=LOCATIONS.filter(l=>filter==='전체'||l.region===filter);
  const popOf=l=>MUNIS[l.accept[0]]?.pop||0;
  list.sort((a,b)=>(cards[b.name]?1:0)-(cards[a.name]?1:0)||popOf(b)-popOf(a));
  list.forEach(l=>{
    const mu=l.accept[0],owned=!!cards[l.name],lv=cardLevel(l.name),rc=REGION_COLORS[l.region]||REGION_COLORS['수도권'];
    const div=document.createElement('div');
    div.className='card-item'+(owned?'':' not-owned');
    div.style.cssText=`background:${rc.bg};border-color:${rc.deep}50`;
    if(owned){
      div.innerHTML=
        `<div class="card-lv-row"><span class="card-lv">${starHTML(lv)}</span><span class="card-cnt">${cards[l.name]>1?`×${cards[l.name]}`:''}</span></div>`+
        `<div class="card-sil-wrap">${cuteLandSVG(mu,lv>=2,lv>=2?l:null,lv>=3?'happy':undefined)}</div>`+
        `<div class="card-name" style="color:${rc.deep}">${cardDisplayName(l)}</div>`+
        `<div class="card-region-chip" style="background:${rc.deep}">${regionLabel(l.region)}</div>`;
      if(canEnhance(l.name)){
        const eb=document.createElement('button');eb.className='enh-mini';
        eb.textContent='⚡ 강화';eb.style.cssText='width:100%;margin-top:4px;background:var(--gold);border:none;border-radius:6px;padding:3px 0;font-size:11px;font-weight:700;cursor:pointer;color:#7a4e00';
        eb.onclick=e=>{e.stopPropagation();if(doEnhance(l.name))renderCollection(filter);};
        div.appendChild(eb);
      }
    }else{
      div.innerHTML=
        `<div class="card-sil-wrap" style="opacity:.3;filter:grayscale(1)">${cuteLandSVG(mu,false)}</div>`+
        `<div class="card-name">???</div>`+
        `<div class="card-region-chip" style="background:${rc.deep}">${regionLabel(l.region)}</div>`;
    }
    grid.appendChild(div);
  });
  const ctp=$('coll-title-progress');if(ctp)ctp.textContent=`${list.filter(l=>cards[l.name]).length}/${list.length} 수집`;
}
function openCollection(){
  show('screen-cards');
  const chipBox=$('coll-chips');if(!chipBox)return;chipBox.innerHTML='';
  ['전체',...MAP_REGIONS].forEach(r=>{const b=document.createElement('button');b.className='chip'+(r==='전체'?' on':'');b.textContent=regionLabel(r);b.onclick=()=>{chipBox.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));b.classList.add('on');renderCollection(r);};chipBox.appendChild(b);});
  renderCollection('전체');
}

// ============================================================
// 종료 / 결과
// ============================================================
function bumpStreak(){const today=new Date().toDateString(),last=store.load('geo_lastday','');if(last===today)return store.load('geo_streak',1);const yest=new Date(Date.now()-864e5).toDateString();const s=(last===yest)?store.load('geo_streak',0)+1:1;store.save('geo_lastday',today);store.save('geo_streak',s);return s;}
function confetti(host){
  if(!host)return;const colors=['#FFD23F','#A4CE4E','#20A2EE','#F2889B','#E2574C'];
  for(let i=0;i<26;i++){const s=document.createElement('span');s.className='confetti-piece';s.style.cssText=`left:${Math.random()*100}%;background:${colors[i%colors.length]};--dx:${(Math.random()-0.5)*200}px;--dy:${50+Math.random()*150}px;animation-delay:${Math.random()*0.5}s`;host.appendChild(s);setTimeout(()=>s.remove(),2000);}
}
function resultComment(acc){if(acc>=90)return'이 감각이면 수능장에서도 흔들리지 않겠어요. 만점 가즈아! 🏆';if(acc>=70)return'상위권 페이스! 틀린 지역만 탐색 모드로 복습하면 완성 💪';if(acc>=50)return'기본기 장착 완료. 빈출 지역부터 한 번 더 돌아봐요 📚';return'오늘 틀린 지역이 수능날의 점수가 됩니다. 탐색 모드부터 차근차근! 🌱';}
function streakComment(n){if(n>=25)return'괴물 같은 집중력! 백지도가 완전히 손에 익었어요 🏆';if(n>=15)return'엄청난 연승! 지리 감각이 폭발하고 있어요 🔥🔥';if(n>=8)return'훌륭해요! 조금만 더 가면 두 자릿수 연승 💪';if(n>=3)return'좋은 출발! 침착하게 한 문제씩 쌓아 봐요 📚';return'한 문제에 끝! 다시 도전해서 연승을 쌓아 보세요 🌱';}

function endGame(){
  stopTimer();clearMapTap();const ms=$('map-svg');if(ms)ms.onclick=null;
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>{const el=$(id);if(el&&el.parentElement)el.parentElement.style.visibility='';});
  show('screen-result');bumpStreak();
  const detail=$('result-detail'),ne=$('name-entry');if(ne)ne.classList.add('hidden');
  if(G.battle){
    const b=G.battle,w=b.scores[0]===b.scores[1]?-1:(b.scores[0]>b.scores[1]?0:1);
    const rt=$('result-title'),rm=$('result-main');
    if(rt)rt.textContent='⚔️ 배틀 결과';if(rm)rm.textContent=w<0?'무승부!':`🏆 ${b.names[w]} 승리!`;
    if(detail)detail.innerHTML=`<table class="vs-table"><tr><td><b>${b.names[0]}</b></td><td>${b.scores[0]}점</td></tr><tr><td><b>${b.names[1]}</b></td><td>${b.scores[1]}점</td></tr></table>`;
    xp+=Math.round((Math.max(0,b.scores[0])+Math.max(0,b.scores[1]))/20);
    const earned=Math.max(0,Math.floor((Math.max(0,b.scores[0])+Math.max(0,b.scores[1]))/320));
    coins+=earned;store.save('geo_coins',coins);updateGachaUI();confetti(document.querySelector('.result-card'));
    saveScoreToFirestore(Math.max(0,b.scores[0])+Math.max(0,b.scores[1]));
  }else{
    const answered=G.idx,acc=answered?Math.round(G.correctCnt/answered*100):0;
    const earned=Math.max(0,Math.floor(G.score/200));
    coins+=earned;store.save('geo_coins',coins);updateGachaUI();
    const rt=$('result-title'),rm=$('result-main');
    if(G.mode==='boss'){
      const need=Math.ceil(G.queue.length*0.7),win=G.correctCnt>=need,first=win&&!titles[G.bossRegion];
      if(win){titles[G.bossRegion]=true;store.save('geo_titles',titles);}
      if(rt)rt.textContent=win?'👹 보스 격파!':'👹 보스가 버텼습니다';if(rm)rm.textContent=`${G.correctCnt} / ${G.queue.length} 격파`;
      if(detail)detail.innerHTML=(win?`🏆 칭호 <b style="color:var(--gold)">${bossTitle(G.bossRegion)}</b> ${first?'획득!':'유지'}`:`${need}타 이상 명중하면 격파!`)+`<br>🪙 +${earned}<br><span style="font-size:.86em">${resultComment(acc)}</span>`;
      xp+=Math.max(0,Math.round(G.score/10));if(win)confetti(document.querySelector('.result-card'));
    }else if(G.mode==='streak'){
      const streak=G.correctCnt,prevBest=store.load('geo_beststreak',0),best=Math.max(streak,prevBest),newRec=streak>prevBest&&streak>0;
      store.save('geo_beststreak',best);if(rt)rt.textContent=newRec?'🔥 최고 연승 기록!':'🔥 연승 종료!';if(rm)rm.textContent=`${streak}연승`;
      if(detail)detail.innerHTML=`점수 <b>${G.score}</b> · 최고 <b>${best}</b>연승`+(earned?`<br>🪙 +${earned}`:'')+`<br><span style="font-size:.86em">${streakComment(streak)}</span>`;
      xp+=Math.max(0,Math.round(G.score/10));if(streak>=10||newRec)confetti(document.querySelector('.result-card'));
    }else if(G.mode==='bingo'){
      const done=G.bingo.cells.filter(c=>c.done).length,lines=G.bingo.lineKeys.size,over=G.bingo.wrong>=2,blackout=done===25;
      if(blackout)store.save('geo_bingo_black',true);if(rt)rt.textContent=blackout?'🧩 빙고 블랙아웃!':over?'🧩 게임 오버':'🧩 빙고 게임 결과';if(rm)rm.textContent=`${done}/25칸 · 빙고 ${lines}줄 · ${G.score}점`;
      if(detail)detail.innerHTML=`정답 ${G.correctCnt}/${answered}`+(earned?`<br>🪙 +${earned}`:'')+`<br><span style="font-size:.86em">${over?'2회 오답으로 종료! 다시 도전해 보세요.':resultComment(acc)}</span>`;
      xp+=Math.max(0,Math.round(G.score/10));if(blackout||lines>=3)confetti(document.querySelector('.result-card'));
    }else if(G.mode==='daily'){
      const today=dayKey(),first=store.load('geo_daily_done','')!==today;
      if(rt)rt.textContent='🔁 오늘의 도전 완료!';if(rm)rm.textContent=`${G.score}점 · 정답 ${G.correctCnt}/${answered}`;
      if(detail)detail.innerHTML=`정답률 ${acc}%`+(earned&&first?`<br>🪙 +${earned}`:'')+`<br><span style="font-size:.86em">${first?'오늘 기록이 등록됐어요! 🏆':'오늘은 이미 도전했어요 — 연습이라 보상은 없어요.'}</span>`;
      if(first){xp+=Math.max(0,Math.round(G.score/10));store.save('geo_daily_done',today);store.save('geo_daily_score',G.score);}
      if(first&&acc>=70)confetti(document.querySelector('.result-card'));
    }else{
      if(rt)rt.textContent=MODE_INFO[G.mode].title+' 결과';if(rm)rm.textContent=G.score+'점';
      if(detail)detail.innerHTML=`정답 ${G.correctCnt}/${answered} (${acc}%) · 최대 콤보 ${G.maxCombo}🔥`+(earned?`<br>🪙 카드 코인 <b style="color:var(--gold)">+${earned}</b>`:'')+`<br><span style="font-size:.86em">${resultComment(acc)}</span>`;
      xp+=Math.max(0,Math.round(G.score/10));if(acc>=70&&answered>=5)confetti(document.querySelector('.result-card'));
      if(G.score>0&&G.mode!=='wanted'){if(ne)ne.classList.remove('hidden');}
    }
    saveScoreToFirestore(Math.max(0,G.score));
  }
  store.save('geo_xp',xp);store.save('geo_maxcombo',Math.max(store.load('geo_maxcombo',0),G.maxCombo||0));
  checkAchievements();
}

// ============================================================
// 이벤트 바인딩
// ============================================================
document.addEventListener('DOMContentLoaded',()=>{
  const bn=$('btn-next');if(bn)bn.onclick=nextQuestion;
  const br=$('btn-retry');if(br)br.onclick=()=>startGame(G.mode,G.bossRegion||undefined);
  const bh=$('btn-home');if(bh)bh.onclick=()=>{initHome();show('screen-home');resetHomeTab();};
  // btn-quit은 두 곳(게임·결과)에 있어 querySelectorAll 사용
  document.querySelectorAll('#btn-quit').forEach(bq=>bq.onclick=()=>{stopTimer();clearMapTap();const ms=$('map-svg');if(ms)ms.onclick=null;['hud-qnum','hud-combo','hud-score'].forEach(id=>{const el=$(id);if(el&&el.parentElement)el.parentElement.style.visibility='';});initHome();show('screen-home');resetHomeTab();});
  const bss=$('btn-save-score');if(bss)bss.onclick=()=>{const name=($('player-name').value.trim()||'무명').slice(0,30);const mode=G.mode,score=G.score;store.save('geo_lastname',name);const list=board[mode]||(board[mode]=[]);list.push({name,score,date:new Date().toISOString().slice(0,10)});list.sort((a,b)=>b.score-a.score);board[mode]=list.slice(0,10);store.save('geo_board',board);if(bss)bss.closest('.name-entry').classList.add('hidden');};
  const tc=$('theme-close');if(tc)tc.onclick=()=>$('theme-modal').classList.add('hidden');
  const mc=$('modes-close');if(mc)mc.onclick=()=>$('modes-modal').classList.add('hidden');
  const tlc=$('themelearn-close');if(tlc)tlc.onclick=()=>$('themelearn-modal').classList.add('hidden');
  const bam=$('btn-all-modes');if(bam)bam.onclick=openModesModal;
  const btl=$('btn-theme-learn');if(btl)btl.onclick=openThemeLearn;
  // 가챠
  document.querySelectorAll('#btn-draw').forEach(b=>{if(b)b.onclick=openGacha;});
  const bda=$('btn-draw-again');if(bda)bda.onclick=openGacha;
  const bgc=$('btn-gacha-close');if(bgc)bgc.onclick=()=>{$('gacha-modal').classList.add('hidden');if($('screen-cards').classList.contains('active'))openCollection();else initHome();};
  // 도감
  const bcoll=$('btn-collection');if(bcoll)bcoll.onclick=openCollection;
  const bcb=$('btn-cards-back');if(bcb)bcb.onclick=()=>{initHome();show('screen-home');};
  const bexp=$('btn-explore');if(bexp)bexp.onclick=()=>startGame('explore');
  // 데이터 초기화
  const rd=$('reset-data');if(rd)rd.onclick=()=>{if(confirm('모든 기록을 초기화할까요?')){
    ['geo_stats','geo_xp','geo_board','geo_wanted','geo_mission','geo_titles','geo_ach','geo_daily_done','geo_daily_score','geo_maxcombo','geo_bingo_black','geo_beststreak','geo_cardlv','geo_coins','geo_cards'].forEach(k=>store.remove(k));
    stats={};xp=0;board={};wanted={};mission=null;titles={};ach={};cardLv={};coins=0;cards={};initHome();
  }};
  // 탭 네비게이션
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{
    const t=b.dataset.tab;document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+t));document.querySelectorAll('.tab-btn').forEach(x=>x.classList.toggle('active',x===b));try{window.scrollTo(0,0);}catch(e){}
  }));
});
function resetHomeTab(){const pb=document.querySelector('.tab-btn[data-tab="play"]');if(pb)pb.click();}

// 전역 노출
window.openThemeModal=openThemeModal;window.openModesModal=openModesModal;window.startGame=startGame;window.openCollection=openCollection;window.expShow=expShow;
