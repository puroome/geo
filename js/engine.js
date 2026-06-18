// ============================================================
// 한국지리 지도 정복 — 게임 엔진 (Firebase Auth + Firestore 통합판)
// ============================================================
'use strict';
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, increment, collection, query, orderBy, limit, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firestore에서 덮어쓸 수 있도록 let 선언 (questions.js의 const 대신)
let MCQ = window.MCQ || [];
let OX  = window.OX  || [];

const $ = id => document.getElementById(id);
document.addEventListener('contextmenu', e => e.preventDefault());
const REGIONS = ['전체','북한','수도권','강원','충청','호남','영남','제주'];
const MAP_REGIONS = ['수도권','강원','충청','호남','영남','제주'];

// ---------- 저장소 ----------
const store = {
  load(key, def){ try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch(e){ return def; } },
  save(key, v){ try { localStorage.setItem(key, JSON.stringify(v)); } catch(e){ /* 저장 불가 환경에서도 게임은 계속 */ } },
  remove(key){ try { localStorage.removeItem(key); } catch(e){} }
};
// 숫자 정화: NaN/Infinity/문자열 → 안전한 숫자(코인·XP 손상 방지)
const num = (v,d=0)=>{ v=+v; return Number.isFinite(v)?v:d; };
let stats = store.load('geo_stats', {});
let xp    = num(store.load('geo_xp', 0));
let board = store.load('geo_board', {});
let wanted = store.load('geo_wanted', {});   // 오답 지역 수배서 {accept키: {miss, streak}}
let titles = store.load('geo_titles', {});   // 권역 보스전 클리어 칭호 {권역: true}
let serverBoard = null;   // 서버 공유 명예의 전당(있으면 우선 표시, 없으면 로컬 fallback)

// ---------- Firebase 명예의 전당 ----------
async function fetchServerBoard(){
  try{
    const q = query(collection(db,'users'), orderBy('totalScore','desc'), limit(10));
    const snap = await getDocs(q);
    serverBoard = snap.docs.map(d=>({
      name: d.data().email?.split('@')[0] || '익명',
      score: d.data().totalScore || 0
    }));
    return serverBoard;
  }catch(e){ return null; }
}
async function postServerScore(mode, name, score){
  if(!currentUser) return null;
  try{
    await updateDoc(doc(db,'users',currentUser.uid),{
      totalScore: increment(score), playCount: increment(1)
    });
    return {ok:true};
  }catch(e){ return null; }
}

// ============================================================
// 👤 Firebase Auth 계정
// ============================================================
let currentUser = null;
let account = null;   // {cls, nickname} — email에서 파생

function scheduleSync(){ /* Firebase는 실시간 저장이므로 별도 sync 불필요 */ }

const RANKS = [
  [0,'🌱 지리 새내기'],[300,'🧭 길눈 밝은 학생'],[800,'🚌 답사 견습생'],
  [1600,'🗺️ 지도 읽는 자'],[2800,'⛰️ 대간 종주자'],[4500,'🚄 국토 순례자'],
  [7000,'🏞️ 지역 전문가'],[10000,'🌏 지도 마스터'],[15000,'👑 한국지리 그랜드마스터']
];

// ---------- 게임 상태 ----------
const G = {
  mode:null, region:'전체',
  queue:[], idx:0, score:0, combo:0, maxCombo:0, correctCnt:0,
  timer:null, timeLeft:0, timeMax:0, oxEnd:0,
  battle:null, locked:false,
};

const MODE_INFO = {
  explore:  {title:'🔍 지도 탐색', useMap:true},
  location: {title:'📍 위치 사냥', useMap:true, n:14, time:30},
  muniname: {title:'🔎 지역 판독', useMap:true, n:12, time:25},
  detective:{title:'🕵️ 지역 추리', useMap:true, n:10, time:55},
  climate:  {title:'🌡️ 기후 비교', useMap:true, n:8, time:40},
  stats:    {title:'📊 통계 비교', useMap:true, n:8, time:40},
  mcq:      {title:'📝 개념 퀴즈', useMap:false, n:10, time:35},
  ox:       {title:'⚡ 스피드 OX (60초)', useMap:false, time:60},
  battle:   {title:'⚔️ 1:1 배틀', useMap:true, n:16, time:30},
  theme:    {title:'🏷️ 테마 게임', useMap:true, n:12, time:30},
  wanted:   {title:'🔍 오답 수배 복습', useMap:true, n:12, time:30},
  boss:     {title:'👹 권역 보스전', useMap:true, n:10, time:30},
  bingo:    {title:'🧩 빙고 게임', useMap:false, n:25, time:22},
  streak:   {title:'🔥 연승 모드', useMap:true, time:0},
  daily:    {title:'🔁 오늘의 도전', useMap:true, n:10, time:26},
  acidrain: {title:'🌧️ 지역 산성비', useMap:false, time:60},
  runner:   {title:'🏃 지리 러너', useMap:false, time:0},
};
const MODE_COLOR={location:'#1278C2',muniname:'#2FA34F',detective:'#6A5ACD',climate:'#E8740C',stats:'#1B4F8F',mcq:'#0F9D8C',ox:'#0FA958',battle:'#E2574C',wanted:'#C2410C',boss:'#B5342A',theme:'#D6336C',bingo:'#8A4FBE',streak:'#E8590C',daily:'#0CA678',acidrain:'#5B8DEF',runner:'#16A34A'};
// 🏷️ 테마 게임: 테마를 고른 뒤 그 테마의 지역만 지도에서 맞히는 퀴즈
let THEMES_CACHE=null;
function buildThemes(){
  if(THEMES_CACHE) return THEMES_CACHE;
  // 인구 1위(도별): 광역시 제외, 각 도(道) 내 최대 인구 시·군을 자료에서 계산
  const provTop={};
  Object.entries(MUNIS).forEach(([n,m])=>{
    if(!m.pop || !m.prov || /특별시|광역시|특별자치시/.test(m.prov)) return;
    if(!provTop[m.prov] || (MUNIS[provTop[m.prov]].pop||0) < m.pop) provTop[m.prov]=n;
  });
  const pop1=Object.entries(provTop).map(([prov,n])=>({a:n, c:`${prov}에서 인구가 가장 많은 시·군`}));
  THEMES_CACHE=[
    {key:'docheong', label:'🏛️ 도청 소재지', items:[
      {a:'수원시',c:'경기도의 도청 소재지'},
      {a:'춘천시',c:'강원특별자치도의 도청 소재지'},
      {a:'청주시',c:'충청북도의 도청 소재지'},
      {a:'홍성군',c:'충청남도의 도청 소재지(내포 신도시)'},
      {a:'전주시',c:'전북특별자치도의 도청 소재지'},
      {a:'무안군',c:'전라남도의 도청 소재지(남악 신도시)'},
      {a:'안동시',c:'경상북도의 도청 소재지'},
      {a:'창원시',c:'경상남도의 도청 소재지'},
      {a:'제주시',c:'제주특별자치도의 도청 소재지'},
    ]},
    {key:'innov', label:'🏢 혁신도시·기업도시', items:[
      {a:'나주시',c:'광주·전남 공동 혁신도시(빛가람동, 한국전력 등)'},
      {a:'김천시',c:'경북 혁신도시(한국도로공사 등)'},
      {a:'진주시',c:'경남 혁신도시(LH 한국토지주택공사)'},
      {a:'원주시',c:'강원 혁신도시(건강보험공단)이자 기업도시'},
      {a:'음성군',c:'충북 혁신도시(진천·음성)'},
      {a:'서귀포시',c:'제주 혁신도시'},
      {a:'완주군',c:'전북 혁신도시(전주·완주)'},
      {a:'태안군',c:'관광 레저형 기업도시'},
      {a:'충주시',c:'지식 기반형 기업도시'},
    ]},
    {key:'festival', label:'🎉 축제', items:[
      {a:'보령시',c:'대천 해수욕장의 머드 축제'},
      {a:'진주시',c:'남강 유등 축제'},
      {a:'함평군',c:'나비 축제'},
      {a:'김제시',c:'지평선 축제(드넓은 평야)'},
      {a:'화천군',c:'산천어 축제(겨울)'},
      {a:'안동시',c:'국제 탈춤 페스티벌'},
      {a:'강릉시',c:'단오제(유네스코 인류무형유산)'},
      {a:'보성군',c:'다향 대축제(녹차밭)'},
      {a:'무주군',c:'반딧불 축제(청정 자연)'},
      {a:'광양시',c:'매화 축제'},
      {a:'금산군',c:'인삼 축제'},
      {a:'이천시',c:'도자기 축제'},
      {a:'하동군',c:'야생차 문화 축제'},
      {a:'영동군',c:'난계 국악·포도 축제'},
    ]},
    {key:'traffic', label:'✈️ 교통(공항·KTX)', items:[
      {a:'인천광역시',c:'영종도 간척지에 세운 우리나라 최대 관문 국제공항이 있는, 수도권 서해안의 항구 도시'},
      {a:'서울특별시',c:'우리나라 수도이자, 강서구에 국내선 중심 김포 국제공항이 있는 도시'},
      {a:'부산광역시',c:'경부 고속철도(KTX)의 종착역과 김해 국제공항을 끼고 있는, 우리나라 제2의 도시이자 최대 무역항'},
      {a:'제주시',c:'우리나라 최대 관광 섬의 북부 관문 국제공항이 있는, 도(道)의 중심 도시'},
      {a:'대구광역시',c:'동대구역(경부 KTX)이 있는, 영남 내륙의 최대 분지 도시'},
      {a:'청주시',c:'충북 도청 소재지로, 경부·호남 고속철도가 갈라지는 오송역과 국제공항이 있는 도시'},
      {a:'무안군',c:'전남 도청(남악 신도시)에 가까운, 호남 서남부의 국제공항이 있는 군(郡)'},
      {a:'양양군',c:'강원 영동(동해안)에 위치해 설악산 관광의 관문이 되는 국제공항이 있는 군(郡)'},
      {a:'대전광역시',c:'경부·호남 고속철도가 갈라지는 분기점이자, 정부청사가 있는 충청권 최대 도시'},
      {a:'광주광역시',c:'호남 고속철도가 지나는 송정역이 있는, 호남 최대 도시'},
      {a:'아산시',c:'충남 북부에 위치해 수도권 전철이 닿고 온양온천으로 유명한, 천안과 이웃한 KTX역 도시'},
      {a:'익산시',c:'전북에서 호남선과 전라선 철도가 갈라지는 교통의 요지인 도시'},
      {a:'강릉시',c:'2018 평창 동계올림픽 빙상 경기가 열린, 경강선 KTX가 닿는 강원 동해안 도시'},
      {a:'경주시',c:'신라 천년의 고도(古都)로 불국사·석굴암이 있는, 신경주역(경부 KTX) 도시'},
    ]},
    {key:'pop1', label:'👥 인구 1위 지역(도별)', items:pop1},
    {key:'special', label:'🍊 특산물', items:[
      {a:'횡성군',c:'한우(축산물 지리적 표시제 1호)'},
      {a:'보성군',c:'녹차(드넓은 차밭)'},
      {a:'영광군',c:'법성포 굴비'},
      {a:'영덕군',c:'대게'},
      {a:'상주시',c:'곶감(감 주산지)'},
      {a:'나주시',c:'배'},
      {a:'의성군',c:'마늘'},
      {a:'성주군',c:'참외'},
      {a:'금산군',c:'인삼'},
      {a:'서귀포시',c:'감귤(따뜻한 기후)'},
      {a:'통영시',c:'굴(남해안 양식)'},
      {a:'고창군',c:'복분자'},
      {a:'청양군',c:'고추·구기자'},
      {a:'광양시',c:'매실'},
    ]},
    {key:'heritage', label:'🏯 유네스코 세계유산', items:[
      {a:'경주시',c:'불국사·석굴암, 경주 역사유적지구'},
      {a:'합천군',c:'해인사 장경판전(팔만대장경)'},
      {a:'서울특별시',c:'종묘·창덕궁·조선 왕릉'},
      {a:'수원시',c:'수원 화성'},
      {a:'안동시',c:'하회마을(한국의 역사마을), 도산서원'},
      {a:'공주시',c:'백제 역사유적지구(공산성)'},
      {a:'부여군',c:'백제 역사유적지구(부소산성·정림사지)'},
      {a:'익산시',c:'백제 역사유적지구(미륵사지)'},
      {a:'고창군',c:'고인돌 유적, 한국의 갯벌'},
      {a:'양산시',c:'통도사(한국의 산지승원)'},
      {a:'영주시',c:'부석사, 소수서원'},
      {a:'보은군',c:'법주사(속리산)'},
      {a:'순천시',c:'선암사, 순천만 갯벌'},
      {a:'김해시',c:'가야고분군(대성동)'},
    ]},
  ];
  THEMES_CACHE.forEach(t=>{ t.items=t.items.filter(it=>MUNIS[it.a]); });   // 자료 안전: 없는 시·군 제외
  return THEMES_CACHE;
}
function themeByKey(k){ return buildThemes().find(t=>t.key===k); }
const BOSS_REGIONS = ['수도권','강원','충청','호남','영남','제주'];
const BOSS_GATE = 0.6, BOSS_MIN_T = 5;   // 숙련도 60%↑(최소 5문항 풀이)면 도전 가능
function bossMastery(r){ const s=stats[r]; return s&&s.t? s.c/s.t : 0; }
function bossUnlocked(r){ const s=stats[r]; return !!s && s.t>=BOSS_MIN_T && s.c/s.t>=BOSS_GATE; }
function bossTitle(r){ return `${regionLabel(r)} 정복자`; }

// 첫 문항(런 시작) 워밍업: 지도 확대·이동·탭 판정을 익히기 전에 시간 초과로 이탈하는 것 방지.
// 지도 조작이 필요한 모드만 대상. 모든 플레이어·모든 런에 동일 적용되므로 공유 랭킹 공정성은 유지됨.
const WARMUP_MODES = new Set(['location','muniname','detective','climate','stats','battle','wanted','theme']);
const WARMUP_MULT = 1.6, WARMUP_ADD = 8;

// 마스코트는 위치 사냥의 '설명형' 문제로 흡수
let LOC_POOL=null;
function locPool(){
  if(LOC_POOL) return LOC_POOL;
  const mascotAssets = (typeof MASCOT_ASSETS !== 'undefined' ? MASCOT_ASSETS : [])
    .filter(a=>a.accept && a.accept[0] && MUNIS[a.accept[0]]);
  const mascotImageByMuni = new Map(mascotAssets.map(a=>[a.accept[0], a.image]));
  const curatedMascots = new Set(MASCOTS.map(m=>m.accept[0]));
  // 시·군별 지역 설명: LOCATION fact 우선 → 기출 노트(noteOf) → 도(道) 위치
  const factByMuni = new Map();
  // muni명에서 대표 지역명 추출(대구광역시→대구). 한 muni에 여러 지점(예: 대구·군위)일 때 대표가 이기도록
  const muniBase=a=>a.replace(/\(.+\)$/,'').replace(/(특별자치시|특별자치도|특별시|광역시|시|군)$/,'');
  LOCATIONS.forEach(l=>l.accept.forEach(a=>{ if(l.fact && l.name===muniBase(a)) factByMuni.set(a, l.fact); }));   // 1차: 이름 일치 대표 우선
  LOCATIONS.forEach(l=>l.accept.forEach(a=>{ if(l.fact && !factByMuni.has(a)) factByMuni.set(a, l.fact); }));      // 2차: 나머지
  const regionDesc=(muni,label,region)=>
    factByMuni.get(muni) || noteOf(label) || `${(MUNIS[muni]||{}).prov || (regionLabel(region)+' 지방')}에 위치한 시·군`;
  const mascotLocs=MASCOTS.map(m=>{
    const mu=MUNIS[m.accept[0]], label=m.accept[0].replace(/\(.+\)$/,'');
    return {name:label, x:mu.cx, y:mu.cy, region:m.region, accept:m.accept,
            image:mascotImageByMuni.get(m.accept[0]) || null, mascotName:m.name,
            fact:`마스코트 ‘${m.name}’의 고장 — ${m.desc}`, descOnly:true,
            desc:m.desc};
  });
  const imageMascotLocs=mascotAssets
    .filter(a=>!curatedMascots.has(a.accept[0]))
    .map(a=>{
      const mu=MUNIS[a.accept[0]], label=a.accept[0].replace(/\(.+\)$/,'');
      const rd=regionDesc(a.accept[0], label, mu.region);
      return {name:label, x:mu.cx, y:mu.cy, region:mu.region, accept:a.accept,
              image:a.image, descOnly:true, imageOnly:true, mascotName:null,
              fact:`${label} — ${rd}`,
              desc:rd};   // 지역 설명을 함께 제시(이미지만으론 어려움)
    });
  LOC_POOL=LOCATIONS.concat(mascotLocs, imageMascotLocs);
  return LOC_POOL;
}
// 설명문에서 지역 이름 가리기
function maskName(text, loc){
  let t=text;
  const names=[loc.name, ...loc.accept];
  names.forEach(n=>{
    const base=n.replace(/\(.+\)$/,'');
    const stem=base.replace(/[시군구]$/,'');
    [base, stem].forEach(s=>{ if(s && s.length>=2) t=t.split(s).join('◯◯'); });
  });
  return t;
}

// ---------- 5개년 기출 빈도 ----------
function freqOf(name){
  const f = FREQ[name] || FREQ[name + '시'] || FREQ[name + '군'];
  return f ? f.count : 0;
}
function freqInfo(name){
  return FREQ[name] || FREQ[name + '시'] || FREQ[name + '군'] || null;
}
function noteOf(name){
  return REGION_NOTES[name] || REGION_NOTES[name + '시'] || REGION_NOTES[name + '군'] || null;
}
function imgSearchLink(keyword, extra){
  const q = encodeURIComponent(keyword + ' ' + (extra || '지리'));
  return `<a class="img-link" href="https://search.naver.com/search.naver?where=image&query=${q}" target="_blank" rel="noopener">📷 ${keyword} 이미지 자료</a>`;
}
function escapeAttr(s){
  return String(s).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
// 빈출 지역 가중 무작위 추출 (비복원)
function weightedSample(items, n, keyFn){
  const pool = items.slice(), out = [];
  while(out.length < n && pool.length){
    const ws = pool.map(it => 1 + Math.min(freqOf(keyFn(it)), 18) / 9);   // 최대 3배로 완화
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    let i = 0;
    for(; i < pool.length - 1; i++){ r -= ws[i]; if(r <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
// 위치·추리 전용: 같은 시·군 중복 금지 + 최근 출제 이력 회피
function sampleLocQueue(items, n){
  const recent=new Set(store.load('geo_recent_locs',[]));
  const used=new Set(), out=[];
  while(out.length<n){
    const avail=items.filter(it=>!used.has(it.accept[0]));
    if(!avail.length) break;
    const ws=avail.map(it=>{
      let w=1+Math.min(freqOf(it.accept[0]),18)/9;     // 빈출 가중 최대 3배
      if(recent.has(it.accept[0])) w*=0.12;            // 최근에 나온 시·군은 강하게 회피
      return w;
    });
    let r=Math.random()*ws.reduce((a,b)=>a+b,0), i=0;
    for(;i<avail.length-1;i++){ r-=ws[i]; if(r<=0) break; }
    used.add(avail[i].accept[0]); out.push(avail[i]);
  }
  const hist=store.load('geo_recent_locs',[]).concat([...used]);
  store.save('geo_recent_locs', hist.slice(-45));       // 최근 45개 시·군 기억
  return out;
}

// ============================================================
// 홈 화면
// ============================================================
// 명예의 전당 렌더 — 항목(모드)별 섹션 + 상위 3명. 서버 공유 랭킹(serverBoard) 우선, 없으면 로컬(board)
const BOARD_MODES=['location','acidrain','runner','streak','theme','bingo','muniname','detective','climate','stats','mcq','ox','battle'];
function renderHomeBoard(){
  const hb=$('home-board'); if(!hb) return;
  const src = serverBoard || board;
  hb.innerHTML=''; let any=false;
  const medal=['🥇','🥈','🥉'];
  // Firebase Auth: 전체 랭킹만 표시
  hb.insertAdjacentHTML('beforeend',
    `<div class="bd-scope">🌐 전체 명예의 전당</div>`);
  BOARD_MODES.forEach(m=>{
    const list=(src[m]||[]).slice(0,3);
    if(!list.length) return;
    any=true;
    const rows=list.map((e,i)=>
      `<div class="bd-row"><span class="bd-rk">${medal[i]||(i+1)}</span><span class="bd-name">${e.name}</span><b class="bd-score">${e.score}점</b></div>`).join('');
    hb.insertAdjacentHTML('beforeend',
      `<div class="bd-group"><div class="bd-head">${MODE_INFO[m].title}</div>${rows}</div>`);
  });
  if(!any) hb.insertAdjacentHTML('beforeend','<div style="color:var(--dim);font-size:.83rem;margin-top:6px">아직 기록이 없습니다. 첫 도전자가 되어 보세요!</div>');
}

function initHome(){
  const chips = $('region-chips'); chips.innerHTML='';
  REGIONS.forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(G.region===r?' on':''); b.textContent=regionLabel(r);
    b.onclick=()=>{ G.region=r; initHome(); };
    chips.appendChild(b);
  });
  let rank=RANKS[0], next=null;
  for(const r of RANKS){ if(xp>=r[0]) rank=r; else { next=r; break; } }
  const streak=store.load('geo_streak',0);
  const today=new Date().toDateString();
  const streakOn = store.load('geo_lastday','')===today;
  $('rank-badge').innerHTML=rank[1]+(streak>=1?` <span class="streak-chip">${streakOn?'🔥':'⏳'} ${streak}일 연속</span>`:'');
  $('xp-bar').style.width = next? Math.min(100,(xp-rank[0])/(next[0]-rank[0])*100)+'%' : '100%';
  if(next){ const remain=next[0]-xp; const games=Math.max(1,Math.ceil(remain/150));
    $('xp-text').textContent=`다음 계급까지 ${remain} XP · 약 ${games}판`; }
  else $('xp-text').textContent='최고 계급 달성!';
  const ml=$('mastery-list'); ml.innerHTML='';
  REGIONS.slice(1).forEach(r=>{
    const s=stats[r]||{c:0,t:0};
    const pct=s.t? Math.round(s.c/s.t*100):0;
    ml.insertAdjacentHTML('beforeend',
      `<div class="mastery-row"><span class="m-name">${r}</span>
       <div class="m-bar"><div class="m-fill" style="width:${pct}%"></div></div>
       <span class="m-val">${pct}% (${s.c}/${s.t})</span></div>`);
  });
  renderHomeBoard();
  fetchServerBoard().then(b=>{ if(b) renderHomeBoard(); });   // 서버 공유 랭킹으로 갱신
  updateGachaUI();
  renderAccount();
  renderPlayHero();
  renderBeginnerGuide();
  renderRecommend();
  renderDaily();
  renderMission();
  renderBoss();
  renderWanted();
  renderWeakReport();
  renderAchievements();
  checkAchievements();   // 기존 진척에 대한 업적 소급 해금
  // 빈출 지역 TOP 12 — 특별·광역시 제외, 시·군 단위만
  $('freq-span').textContent=`${FREQ_SPAN.span} 고3 학평·모평·수능 ${FREQ_SPAN.files}회분 언급 횟수(시·군 기준) — 빈출 지역은 게임에서 더 자주 출제됩니다`;
  const fl=$('freq-list'); fl.innerHTML='';
  const METRO_RE=/(특별시|광역시|특별자치시)$/;
  const top=Object.entries(FREQ)
    .filter(([name])=>MUNIS[name] && !METRO_RE.test(name))
    .sort((a,b)=>b[1].count-a[1].count).slice(0,12);
  const max=top.length?top[0][1].count:1;
  top.forEach(([name,v],i)=>{
    fl.insertAdjacentHTML('beforeend',
      `<div class="freq-row"><span class="f-rank">${i+1}</span><span class="f-name">${name.replace(/\(.+\)$/,'')}</span>
       <div class="f-bar"><div class="f-fill" style="width:${Math.round(v.count/max*100)}%"></div></div>
       <span class="f-val">${v.count}회·${v.exams}개 시험</span></div>`);
  });
}

// 🎯 오늘의 지리 미션 렌더
function renderMission(){
  const box=$('mission-body'); if(!box) return;
  ensureMission();
  box.innerHTML=mission.list.map(it=>{
    const d=missionDef(it.id); if(!d) return '';
    const prog=Math.min(it.prog,d.goal), pct=Math.round(prog/d.goal*100);
    const state = it.claimed ? '<span class="ms-claimed">✓ 완료</span>'
      : it.done ? `<button class="ms-claim" data-mid="${it.id}">받기 🪙${d.reward.c}·XP${d.reward.x}</button>`
      : `<span class="ms-prog">${prog}/${d.goal}</span>`;
    return `<div class="mission-row${it.done?' done':''}">
      <div class="ms-top"><span class="ms-label">${d.label}</span>${state}</div>
      <div class="ms-bar"><div class="ms-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
  box.querySelectorAll('.ms-claim').forEach(b=>b.onclick=()=>claimMission(b.dataset.mid));
}

// 👤 계정 칩
function renderAccount(){
  const el=$('account-chip'); if(!el) return;
  if(currentUser){
    const emailId = currentUser.email.split('@')[0];
    el.innerHTML=`👤 ${emailId}`; el.classList.add('on');
    el.onclick=()=>{ if(confirm(`${emailId} 로그아웃?`)) signOut(auth).then(()=>window.location.href='index.html'); };
  }
  else { el.innerHTML='👤 로그인'; el.classList.remove('on'); }
}

// 🧭 마스코트 추천 도전 — 상태에 맞는 '오늘 할 것' 한 줄 제안
// 추천 행동 한 가지 결정(보스 > 오답 수배 > 초보 탐색 > 약점 권역 > 기본)
function recommendAction(){
  const bossCand=BOSS_REGIONS.filter(r=>bossUnlocked(r)&&!titles[r])
    .sort((a,b)=>bossMastery(b)-bossMastery(a))[0];
  const wn=Object.keys(wanted).length;
  if(bossCand) return {text:`${regionLabel(bossCand)} 숙련도 ${Math.round(bossMastery(bossCand)*100)}%! 보스전 도전 각이야 👹`,
    label:'보스전 도전', action:()=>startGame('boss', bossCand)};
  if(wn>0) return {text:`최근 틀린 지역 ${wn}곳이 수배 중! 이것부터 잡고 가자 🔍`,
    label:`오답 ${wn}곳 복습`, action:()=>{ G.region='전체'; startGame('wanted'); }};
  if(xp<300) return {text:'처음이라면 지도 탐색으로 지도와 친해져 볼까? 🗺️',
    label:'지도 탐색', action:()=>startGame('explore')};
  const weak=BOSS_REGIONS.filter(r=>{ const s=stats[r]; return s&&s.t>=3; })
    .sort((a,b)=>bossMastery(a)-bossMastery(b))[0];
  if(weak && bossMastery(weak)<0.7) return {text:`${regionLabel(weak)}이 조금 약해. 위치 사냥으로 다져볼까? 💪`,
    label:`${regionLabel(weak)} 연습`, action:()=>{ G.region=weak; startGame('location'); }};
  return {text:'오늘의 미션부터 깨 보자! 작은 목표가 실력이 돼 🎯',
    label:'위치 사냥 시작', action:()=>{ G.region='전체'; startGame('location'); }};
}
function renderRecommend(){
  const bubble=$('rec-bubble'), btn=$('rec-btn'); if(!bubble||!btn) return;
  const r=recommendAction();
  bubble.textContent=r.text; btn.textContent=r.label; btn.onclick=r.action;
}
// 🏠 첫 화면(플레이 탭) 추천 한 판 + 미션 요약 — "어디부터?" 고민 줄이기
function renderPlayHero(){
  const box=$('play-hero'); if(!box) return;
  const r=recommendAction();
  ensureMission();
  const done=mission.list.filter(m=>m.done).length, total=mission.list.length;
  box.innerHTML=
    `<div class="ph-label">오늘의 추천 한 판</div>`+
    `<div class="ph-text">${r.text}</div>`+
    `<button class="ph-btn" id="ph-start">▶ ${r.label}</button>`+
    `<button class="ph-mission" id="ph-mission">🎯 오늘의 미션 ${done}/${total} 달성 · 보러 가기 →</button>`;
  $('ph-start').onclick=r.action;
  $('ph-mission').onclick=()=>{ const t=document.querySelector('.tab-btn[data-tab="challenge"]'); if(t) t.click(); };
}
// 🔰 초보자 추천 순서 (계정/기록이 적을 때만)
function renderBeginnerGuide(){
  const box=$('beginner-guide'); if(!box) return;
  if(xp>=300){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const steps=[
    {m:'explore', n:'1 · 지도 탐색', d:'지도와 친해지기'},
    {m:'location', n:'2 · 위치 사냥', d:'위치 맞히기'},
    {m:'muniname', n:'3 · 지역 판독', d:'이름 맞히기'},
    {m:'mcq', n:'4 · 개념 퀴즈', d:'개념 정리'},
    {m:'climate', n:'5 · 기후·통계', d:'비교 분석'},
  ];
  box.innerHTML='<div class="bg-title">🔰 처음이라면 이 순서를 추천해요</div>'+
    '<div class="bg-steps">'+steps.map(s=>`<button class="bg-step" data-m="${s.m}"><b>${s.n}</b><small>${s.d}</small></button>`).join('')+'</div>';
  box.querySelectorAll('.bg-step').forEach(b=>b.onclick=()=>startGame(b.dataset.m));
}

// 🩹 약점 리포트 — 권역별 정답률(약한 순) + 자주 틀린 시·군(수배) + 바로 복습
function renderWeakReport(){
  const box=$('weak-body'); if(!box) return;
  const regs=BOSS_REGIONS.map(r=>({r, s:stats[r]||{c:0,t:0}}))
    .filter(x=>x.s.t>=3)
    .map(x=>({r:x.r, pct:Math.round(x.s.c/x.s.t*100), t:x.s.t}))
    .sort((a,b)=>a.pct-b.pct);
  const misses=Object.entries(wanted).map(([k,v])=>({k, miss:v.miss||0}))
    .filter(x=>x.miss>0).sort((a,b)=>b.miss-a.miss).slice(0,8);
  if(!regs.length && !misses.length){
    box.innerHTML='<div class="t-msg" style="color:var(--dim)">아직 분석할 데이터가 부족해요. 게임을 몇 판 하면 약한 권역·지역이 여기에 표시됩니다 📊</div>';
    return;
  }
  let html='';
  if(regs.length){
    html+='<div class="wr-head">권역별 정답률 (약한 순)</div>';
    html+=regs.slice(0,3).map(x=>{
      const col=x.pct<50?'var(--red)':x.pct<70?'var(--gold)':'var(--grass)';
      return `<div class="wr-row"><span class="wr-name">${regionLabel(x.r)}</span>`+
        `<div class="wr-bar"><div class="wr-fill" style="width:${x.pct}%;background:${col}"></div></div>`+
        `<span class="wr-val">${x.pct}%</span></div>`;
    }).join('');
    html+=`<button class="wr-btn" id="wr-practice">🎯 ${regionLabel(regs[0].r)} 집중 연습</button>`;
  }
  if(misses.length){
    html+='<div class="wr-head" style="margin-top:13px">자주 틀린 지역</div>';
    html+=`<div class="wr-chips">${misses.map(m=>`<span class="wr-chip">${m.k.replace(/\(.+\)$/,'')} <b>${m.miss}회</b></span>`).join('')}</div>`;
    html+=`<button class="wr-btn ghost" id="wr-wanted">🔍 틀린 지역만 복습 (${Math.min(Object.keys(wanted).length, MODE_INFO.wanted.n)}문제)</button>`;
  }
  box.innerHTML=html;
  const wp=$('wr-practice'); if(wp) wp.onclick=()=>{ G.region=regs[0].r; startGame('location'); };
  const ww=$('wr-wanted'); if(ww) ww.onclick=()=>{ G.region='전체'; startGame('wanted'); };
}

// 🗂️ 테마별 학습 — 테마를 골라 해당 지역들을 설명과 함께 훑어보고(학습), 바로 퀴즈로 연결
function openThemeLearn(){
  const box=$('themelearn-list'); if(!box){ return; }
  $('themelearn-title').textContent='🗂️ 테마별 학습';
  box.classList.remove('study');
  box.innerHTML='';
  buildThemes().forEach(t=>{
    const b=document.createElement('button');
    b.className='theme-pick';
    b.innerHTML=`<span class="tp-label">${t.label}</span><span class="tp-count">${t.items.length}개 지역</span>`;
    b.onclick=()=>showThemeLearn(t);
    box.appendChild(b);
  });
  $('themelearn-modal').classList.remove('hidden');
}
function showThemeLearn(t){
  $('themelearn-title').textContent=t.label;
  const box=$('themelearn-list'); box.classList.add('study');
  box.innerHTML=
    '<div class="tl-list">'+t.items.map(it=>{
      const muni=it.a.replace(/\(.+\)$/,''); const prov=(MUNIS[it.a]||{}).prov||'';
      return `<div class="tl-item"><div class="tl-top"><b>${muni}</b> <span class="tl-prov">${prov}</span></div><div class="tl-desc">${it.c}</div></div>`;
    }).join('')+'</div>'+
    `<div class="tl-actions"><button class="ghost-btn" id="tl-back">← 테마 목록</button><button class="primary-btn" id="tl-quiz">🏷️ 이 테마로 퀴즈</button></div>`;
  $('tl-back').onclick=openThemeLearn;
  $('tl-quiz').onclick=()=>{ $('themelearn-modal').classList.add('hidden'); startGame('theme', t.key); };
}

// 👹 권역 보스전 — 숙련도 게이트 + 칭호
function renderBoss(){
  const box=$('boss-body'); if(!box) return;
  box.innerHTML=BOSS_REGIONS.map(r=>{
    const m=Math.round(bossMastery(r)*100), unlocked=bossUnlocked(r), cleared=!!titles[r];
    const right = cleared ? `<span class="boss-tag">🏆 정복</span>`
      : unlocked ? `<span class="boss-go">도전 ▶</span>`
      : `<span class="boss-lock">🔒 ${m}%</span>`;
    return `<button class="boss-btn${unlocked?'':' locked'}${cleared?' cleared':''}" data-region="${r}" ${unlocked?'':'disabled'}>
      <span class="boss-name">${regionLabel(r)}</span>${right}</button>`;
  }).join('');
  box.querySelectorAll('.boss-btn:not([disabled])').forEach(b=>b.onclick=()=>startGame('boss', b.dataset.region));
}

// 🔍 오답 지역 수배서 — 틀린 시·군을 모아 복습 유도
function renderWanted(){
  const box=$('wanted-body'); if(!box) return;
  const keys=Object.keys(wanted).sort((a,b)=>wanted[b].miss-wanted[a].miss);
  if(!keys.length){
    box.innerHTML='<div class="wanted-empty">수배 중인 지역이 없습니다. 위치 사냥·지역 판독·추리에서 틀린 시·군이 자동으로 여기에 모입니다.</div>';
    return;
  }
  const danger=keys.filter(m=>wanted[m].miss>=3).length;
  const chips=keys.map(m=>{
    const w=wanted[m], dg=w.miss>=3;
    return `<span class="wanted-chip${dg?' danger':''}">${dg?'🚨 ':''}${muniShort(m)}<small>${w.miss}회</small></span>`;
  }).join('');
  box.innerHTML=
    `<div class="wanted-sub">${keys.length}개 지역 수배 중${danger?` · <b style="color:var(--red)">위험 ${danger}곳</b>`:''} · 2연속 정답 시 해제</div>`+
    `<div class="wanted-chips">${chips}</div>`+
    `<button class="primary-btn" id="btn-wanted-review">🎯 수배 지역만 복습 (${Math.min(keys.length,MODE_INFO.wanted.n)}문제)</button>`;
  $('btn-wanted-review').onclick=()=>{ G.region='전체'; startGame('wanted'); };
}

const MODE_CTA={location:'사냥 시작!',theme:'테마 찾기!',muniname:'판독 시작!',detective:'추리 시작!',climate:'분석 도전!',stats:'비교 도전!',mcq:'퀴즈 시작!',ox:'스피드 OX!',battle:'대결 시작!',bingo:'빙고 도전!',streak:'연승 도전!',acidrain:'산성비 막기!',runner:'달리기 시작!'};
document.querySelectorAll('.mode-card').forEach(c=>{
  c.onclick=()=> c.dataset.mode==='theme' ? openThemeModal() : startGame(c.dataset.mode);
  const p=c.querySelector('.mode-play'); if(p&&MODE_CTA[c.dataset.mode]) p.textContent=MODE_CTA[c.dataset.mode]+' ▶';
});
// 🏷️ 테마 선택 모달
function openThemeModal(){
  const box=$('theme-list'); if(!box){ startGame('theme','docheong'); return; }
  box.innerHTML='';
  buildThemes().forEach(t=>{
    const b=document.createElement('button');
    b.className='theme-pick';
    b.innerHTML=`<span class="tp-label">${t.label}</span><span class="tp-count">${t.items.length}개 지역</span>`;
    b.onclick=()=>{ $('theme-modal').classList.add('hidden'); startGame('theme', t.key); };
    box.appendChild(b);
  });
  $('theme-modal').classList.remove('hidden');
}
$('theme-close')?.addEventListener('click', ()=>$('theme-modal').classList.add('hidden'));

// 🎮 전체 모드 보기 (캐러셀에서 뒤쪽 모드를 놓치지 않도록 2열 그리드 제공)
const PLAY_MODES=[
  {m:'location', name:'📍 위치 사냥', desc:'이름·설명 보고 지도 탭'},
  {m:'theme',    name:'🏷️ 테마 게임', desc:'도청·축제·특산물 등 테마'},
  {m:'bingo',    name:'🧩 빙고 게임', desc:'5×5 빙고판, 2번 틀리면 끝'},
  {m:'streak',   name:'🔥 연승 모드', desc:'시간제한 없이, 틀리면 종료'},
  {m:'muniname', name:'🔎 지역 판독', desc:'깜빡이는 시·군 이름 맞히기'},
  {m:'detective',name:'🕵️ 지역 추리', desc:'힌트를 열며 추리'},
  {m:'climate',  name:'🌡️ 기후 비교', desc:'두 지역 기후 상대 비교'},
  {m:'stats',    name:'📊 통계 비교', desc:'두 시·도 통계 대결'},
  {m:'mcq',      name:'📝 개념 퀴즈', desc:'4지선다 170여 문항'},
  {m:'ox',       name:'⚡ 스피드 OX', desc:'60초 타임어택'},
  {m:'battle',   name:'⚔️ 1:1 배틀', desc:'친구와 점수 대결'},
];
function openModesModal(){
  const box=$('modes-list'); if(!box) return;
  box.innerHTML='';
  PLAY_MODES.forEach(pm=>{
    const b=document.createElement('button');
    b.className='mode-tile'; b.style.setProperty('--mc', MODE_COLOR[pm.m]||'#1278C2');
    b.innerHTML=`<span class="mt-name">${pm.name}</span><span class="mt-desc">${pm.desc}</span>`;
    b.onclick=()=>{ $('modes-modal').classList.add('hidden'); pm.m==='theme'?openThemeModal():startGame(pm.m); };
    box.appendChild(b);
  });
  $('modes-modal').classList.remove('hidden');
}
$('btn-all-modes')?.addEventListener('click', openModesModal);
$('modes-close')?.addEventListener('click', ()=>$('modes-modal').classList.add('hidden'));
$('btn-theme-learn')?.addEventListener('click', openThemeLearn);
$('themelearn-close')?.addEventListener('click', ()=>$('themelearn-modal').classList.add('hidden'));
// 🪙 코인 칩 탭 → 도감(카드 뽑기) 탭으로 (코인 사용처 안내)
document.querySelector('.coin-chip')?.addEventListener('click', ()=>{
  const t=document.querySelector('.tab-btn[data-tab="collection"]'); if(t) t.click();
});
$('reset-data').onclick=()=>{
  if(confirm('모든 기록(점수·숙련도·랭킹·수배서)을 초기화할까요?')){
    store.remove('geo_stats'); store.remove('geo_xp'); store.remove('geo_board'); store.remove('geo_wanted'); store.remove('geo_mission'); store.remove('geo_titles');
    ['geo_ach','geo_daily_done','geo_daily_score','geo_maxcombo','geo_bingo_black','geo_beststreak','geo_cardlv'].forEach(k=>store.remove(k));
    stats={}; xp=0; board={}; wanted={}; mission=null; titles={}; ach={}; cardLv={}; initHome();
  }
};

// ============================================================
// 지도 렌더링 (시·군 단위 + 시·도 외곽선 오버레이)
// ============================================================
const VIEW0 = {x:-8, y:-8, w:776, h:822};
let view = {...VIEW0};
let svgBuilt=false;

function buildMap(){
  const svg=$('map-svg');
  svg.innerHTML='';
  applyView();
  for(const [name,m] of Object.entries(MUNIS)){
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',m.d);
    path.setAttribute('class','muni');
    path.dataset.name=name; path.dataset.prov=m.prov; path.dataset.region=m.region;
    svg.appendChild(path);
  }
  for(const [name,p] of Object.entries(PROVINCES)){
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',p.d);
    path.setAttribute('class','prov-border');
    svg.appendChild(path);
  }
  svgBuilt=true;
}
function applyView(){
  $('map-svg').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
}
// 부드러운 뷰 전환 (ease-out)
let viewAnimId=null;
let VIEW_ANIM_MS=240;
function animateView(tv){
  if(viewAnimId){ cancelAnimationFrame(viewAnimId); viewAnimId=null; }
  if(VIEW_ANIM_MS<=0 || typeof requestAnimationFrame!=='function'){
    view={...tv}; applyView(); return;
  }
  const from={...view};
  const t0=(typeof performance!=='undefined'?performance.now():0);
  const step=(t)=>{
    const k=Math.min(1,(t-t0)/VIEW_ANIM_MS);
    const e=1-Math.pow(1-k,3);                     // ease-out cubic
    view={x:from.x+(tv.x-from.x)*e, y:from.y+(tv.y-from.y)*e,
          w:from.w+(tv.w-from.w)*e, h:from.h+(tv.h-from.h)*e};
    applyView();
    if(k<1) viewAnimId=requestAnimationFrame(step); else viewAnimId=null;
  };
  viewAnimId=requestAnimationFrame(step);
}
function clampedTarget(tv){
  const old={...view}; view=tv; clampView(); const r={...view}; view=old; return r;
}
function resetView(){ animateView({...VIEW0}); }
function zoomAt(cx, cy, factor){
  const nw=Math.min(VIEW0.w, Math.max(VIEW0.w/8, view.w*factor));
  const k=nw/view.w;
  animateView(clampedTarget({x:cx-(cx-view.x)*k, y:cy-(cy-view.y)*k, w:nw, h:view.h*k}));
}
function clampView(){
  view.x=Math.max(VIEW0.x-60, Math.min(view.x, VIEW0.x+VIEW0.w-view.w+60));
  view.y=Math.max(VIEW0.y-60, Math.min(view.y, VIEW0.y+VIEW0.h-view.h+60));
}
function svgPoint(clientX, clientY){
  const svg=$('map-svg');
  const pt=svg.createSVGPoint(); pt.x=clientX; pt.y=clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// ----- 터치 팬/핀치 줌 (탭과 구분) -----
let suppressTap=false;
function initMapGestures(){
  const svg=$('map-svg');
  const ptrs=new Map();
  let panStart=null, pinch0=null, moved=false;
  svg.addEventListener('pointerdown',e=>{
    // 새 제스처(첫 손가락) 시작 시 상태 리셋 — 이전에 pointerup/cancel이 유실돼 남은 좀비 포인터로
    // suppressTap이 true로 고착되어 탭이 먹통 되던 문제 방지(자가 복구)
    if(e.isPrimary){ ptrs.clear(); suppressTap=false; moved=false; panStart=null; pinch0=null; }
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===1){ panStart={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y}; moved=false; }
    else if(ptrs.size===2){
      // 핀치 시작: 시작 시점의 뷰와 손가락 중점 아래의 지도 좌표(앵커)를 고정
      if(viewAnimId){ cancelAnimationFrame(viewAnimId); viewAnimId=null; }
      const [a,b]=[...ptrs.values()];
      const rect=svg.getBoundingClientRect();
      const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
      pinch0={d:Math.hypot(a.x-b.x,a.y-b.y), v:{...view},
              ax:view.x+(mx-rect.left)/rect.width*view.w,
              ay:view.y+(my-rect.top)/rect.height*view.h};
      panStart=null;
    }
  });
  svg.addEventListener('pointermove',e=>{
    if(!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const rect=svg.getBoundingClientRect();
    if(ptrs.size===2 && pinch0){
      const [a,b]=[...ptrs.values()];
      const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(Math.abs(d-pinch0.d)>6) { moved=true; suppressTap=true; }
      if(moved){
        // 시작 상태 기준으로만 계산 → 드리프트 없음. 앵커가 항상 손가락 중점 아래에 유지
        const nw=Math.min(VIEW0.w, Math.max(VIEW0.w/8, pinch0.v.w*(pinch0.d/d)));
        const nh=pinch0.v.h*(nw/pinch0.v.w);
        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
        view={x:pinch0.ax-(mx-rect.left)/rect.width*nw,
              y:pinch0.ay-(my-rect.top)/rect.height*nh, w:nw, h:nh};
        clampView(); applyView();
      }
    } else if(ptrs.size===1 && panStart){
      const scale=panStart.vw!==undefined?panStart.vw/rect.width:view.w/rect.width;
      const dx=(e.clientX-panStart.x), dy=(e.clientY-panStart.y);
      // 탭 슬롭 24px: 손가락이 살짝 흔들려도(보스전 급탭 등) 팬으로 오인하지 않음.
      // (10px로는 미세 이동에 moved=true→preventDefault로 탭(click)이 통째로 사라지는 문제가 잦았음)
      if(Math.abs(dx)+Math.abs(dy)>24){ moved=true; suppressTap=true; }
      if(moved){                          // 확대 여부와 무관하게 항상 팬 (페이지 스크롤과 분리)
        view.x=panStart.vx-dx*scale; view.y=panStart.vy-dy*scale;
        clampView(); applyView();
      }
    }
    if(moved || ptrs.size===2){ try { e.preventDefault(); } catch(err){} }
  });
  const up=e=>{
    // 탭(이동 없음)이면 터치 지점에 물결 효과
    if(ptrs.size===1 && !moved && !suppressTap){
      try { const p=svgPoint(e.clientX,e.clientY); tapRipple(p.x,p.y); } catch(err){}
    }
    ptrs.delete(e.pointerId);
    if(ptrs.size<2) pinch0=null;
    if(ptrs.size===1){
      // 핀치 → 한 손가락 전환: 남은 손가락 기준으로 팬 기준점 재설정 (점프 방지)
      const [rest]=[...ptrs.values()];
      panStart={x:rest.x, y:rest.y, vx:view.x, vy:view.y, vw:view.w};
    }
    if(ptrs.size===0){ panStart=null; setTimeout(()=>{ suppressTap=false; },50); }
  };
  svg.addEventListener('pointerup',up);
  svg.addEventListener('pointercancel',up);
  // 지도 밖에서 손가락을 떼면 svg pointerup이 안 와서 좀비 포인터가 남음 → window에서 정리
  const winCleanup=e=>{
    if(!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if(ptrs.size<2) pinch0=null;
    if(ptrs.size===0){ panStart=null; suppressTap=false; }
  };
  window.addEventListener('pointerup',winCleanup);
  window.addEventListener('pointercancel',winCleanup);
  svg.addEventListener('wheel',e=>{   // 데스크톱 휠 줌
    e.preventDefault();
    const p=svgPoint(e.clientX,e.clientY);
    zoomAt(p.x,p.y, e.deltaY>0?1.25:0.8);
  },{passive:false});
  $('zoom-in').onclick=()=>zoomAt(view.x+view.w/2, view.y+view.h/2, 0.7);
  $('zoom-out').onclick=()=>zoomAt(view.x+view.w/2, view.y+view.h/2, 1.45);
  $('zoom-reset').onclick=resetView;
}

// 탭 물결 효과
function tapRipple(x, y){
  const svg=$('map-svg');
  const r=document.createElementNS('http://www.w3.org/2000/svg','circle');
  r.setAttribute('cx',x); r.setAttribute('cy',y); r.setAttribute('r',6);
  r.setAttribute('class','tap-ripple');
  svg.appendChild(r);
  setTimeout(()=>r.remove(), 500);
}
function clearMapExtras(){
  document.querySelectorAll('#map-svg .loc-dot, #map-svg .loc-label, #map-svg .click-mark, #map-svg .match-mark').forEach(e=>e.remove());
  document.querySelectorAll('#map-svg .muni').forEach(p=>p.classList.remove('correct','wrong','flash','dim-region','pulse'));
}
function muniEl(name){ return document.querySelector(`#map-svg .muni[data-name="${name}"]`); }
function addDot(x, y, r, cls){
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r',r);
  c.setAttribute('class',cls);
  $('map-svg').appendChild(c); return c;
}
function addLabel(x, y, text, cls){
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('x',x); t.setAttribute('y',y);
  t.setAttribute('text-anchor','middle'); t.setAttribute('class','loc-label'+(cls?' '+cls:''));
  t.textContent=text; $('map-svg').appendChild(t); return t;
}
// 오답으로 탭한 시·군에 빨간 이름 라벨
function labelWrongMuni(name){
  const m=MUNIS[name];
  if(m) addLabel(m.cx, m.cy+4, name.replace(/\(.+\)$/,''), 'bad');
}
// 권역 경계 박스 (문제 시작 시 자동 확대용)
let REGION_BBOX=null;
function regionBBox(region){
  if(!REGION_BBOX){
    REGION_BBOX={};
    for(const [n,m] of Object.entries(MUNIS)){
      const bb=muniBBox(n);
      const r=REGION_BBOX[m.region]||(REGION_BBOX[m.region]={minx:1e9,miny:1e9,maxx:-1e9,maxy:-1e9});
      r.minx=Math.min(r.minx,bb.x); r.miny=Math.min(r.miny,bb.y);
      r.maxx=Math.max(r.maxx,bb.x+bb.w); r.maxy=Math.max(r.maxy,bb.y+bb.h);
    }
  }
  return REGION_BBOX[region];
}
// 출제 지역의 권역으로 부드럽게 확대 (정답 자체는 노출하지 않음)
function fitRegion(region){
  const r=regionBBox(region);
  if(!r) return;
  fitViewTo([{x:r.minx,y:r.miny},{x:r.maxx,y:r.maxy}], 26);
}
function dimOtherRegions(region){
  if(region==='전체') return;
  document.querySelectorAll('#map-svg .muni').forEach(p=>{
    if(p.dataset.region!==region) p.classList.add('dim-region');
  });
}
// ----- 지도 탭 리스너 중앙 관리: 문제 전환·이탈 시 반드시 해제 -----
let activeMapTap=null;
function setMapTap(fn){
  clearMapTap();
  activeMapTap=fn;
  $('map-svg').addEventListener('click',fn);
}
function clearMapTap(){
  if(activeMapTap){ $('map-svg').removeEventListener('click',activeMapTap); activeMapTap=null; }
}
// 각 시·군 탭 핸들러 등록(1회성)
function onMuniTap(fn){
  const handler=(e)=>{
    if(suppressTap || G.locked) return;
    const t=e.target.closest('.muni');
    if(!t) return;
    clearMapTap();
    fn(t, e);
  };
  setMapTap(handler);
  return clearMapTap;
}

// ============================================================
// 공통 흐름
// ============================================================
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); $(id).classList.add('active'); try{ window.scrollTo(0,0); }catch(e){} }
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function pool(mode){
  const r=G.region;
  if(mode==='location'||mode==='detective'){
    const base=locPool();
    let L=base.filter(l=>r==='전체'||l.region===r);
    return L.length>=4?L:base;
  }
  if(mode==='muniname'){
    let M=Object.keys(MUNIS).filter(n=>r==='전체'||MUNIS[n].region===r);
    return M.length>=4?M:Object.keys(MUNIS);
  }
  if(mode==='climate'){
    const stReg=n=>CLIMATE.find(c=>c.name===n)?.region;
    let M=CLIMATE_SETS.filter(s=>r==='전체'||s.st.some(n=>stReg(n)===r)).map(s=>({kind:'match',set:s}));
    return M.length>=4?M:CLIMATE_SETS.map(s=>({kind:'match',set:s}));   // 순서형 제거: 지도 탭형만
  }
  if(mode==='stats'){
    let P=STAT_SETS.filter(s=>r==='전체'||s.sd.some(n=>PROVINCES[n]?.region===r));
    return P.length>=2?P:STAT_SETS;
  }
  if(mode==='mcq'){ const M=MCQ.filter(q=>r==='전체'||q.region===r); return M.length?M:MCQ; }
  if(mode==='ox'){ const O=OX.filter(q=>r==='전체'||q.region===r); return O.length?O:OX; }
  return [];
}

// 👹 권역 보스전 출제 — 해당 권역 위주 혼합 10문항(위치·판독·개념·OX·기후)
function bossQueue(region){
  const prevR=G.region; G.region=region;
  const locs  = sampleLocQueue(pool('location'), 3);
  const munis = weightedSample(pool('muniname'), 3, n=>n);
  const mcqs  = shuffle(pool('mcq')).slice(0,2);
  const oxs   = shuffle(pool('ox')).slice(0,1);
  const clim  = shuffle(pool('climate')).slice(0,1);
  G.region=prevR;
  const q=[];
  locs.forEach(l=>l&&q.push({btype:'location', item:l}));
  munis.forEach(m=>m&&q.push({btype:'muniname', item:m}));
  mcqs.forEach(m=>m&&q.push({btype:'mcq', item:m}));
  oxs.forEach(o=>o&&q.push({btype:'ox', item:o}));
  clim.forEach(c=>c&&q.push({btype:'climate', item:c}));
  return shuffle(q).slice(0, MODE_INFO.boss.n);
}

// 🔥 연승 모드 출제 — 위치·판독·개념·OX 혼합을 끝없이 보충(시간 제한 없음)
function streakRefill(n){
  const out=[];
  const locs  = sampleLocQueue(pool('location'), Math.ceil(n*0.5));
  const munis = weightedSample(pool('muniname'), Math.ceil(n*0.2), x=>x);
  const mcqs  = shuffle(pool('mcq')).slice(0, Math.ceil(n*0.2));
  const oxs   = shuffle(pool('ox')).slice(0, Math.ceil(n*0.15));
  locs.forEach(l=>l&&out.push({btype:'location', item:l}));
  munis.forEach(m=>m&&out.push({btype:'muniname', item:m}));
  mcqs.forEach(m=>m&&out.push({btype:'mcq', item:m}));
  oxs.forEach(o=>o&&out.push({btype:'ox', item:o}));
  return shuffle(out);
}

// 🔁 오늘의 도전 — 날짜 시드로 전국 학생이 같은 10문항을 받는다(공정한 일일 랭킹)
function dayKey(d){ d=d||new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function seededRnd(str){ let s=hashStr(str)||1; return ()=>{ s^=s<<13; s^=s>>>17; s^=s<<5; s>>>=0; return s/4294967296; }; }
function dailyQueue(){
  const rnd=seededRnd('daily-'+dayKey());
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const locs=locPool().filter(l=>l.accept&&(l.fact||l.desc));
  const munis=Object.keys(MUNIS);
  const plan=['location','mcq','location','muniname','ox','location','mcq','muniname','ox','location'];
  return plan.map(t=> t==='location'?{btype:'location',item:pick(locs)}
                    : t==='muniname'?{btype:'muniname',item:pick(munis)}
                    : t==='mcq'?{btype:'mcq',item:pick(MCQ)}
                    : {btype:'ox',item:pick(OX)});
}
async function postDailyScore(day, name, score){
  if(!currentUser) return null;
  try{
    await setDoc(doc(db,`daily/${day}/scores`,currentUser.uid), {name, score, uid:currentUser.uid, t:serverTimestamp()});
    return {ok:true};
  }catch(e){ return null; }
}
async function fetchDaily(day){
  try{
    const q = query(collection(db,`daily/${day}/scores`), orderBy('score','desc'), limit(10));
    const snap = await getDocs(q);
    return snap.docs.map(d=>({name:d.data().name, score:d.data().score}));
  }catch(e){ return null; }
}
function renderDaily(){
  const box=$('daily-body'); if(!box) return;
  const today=dayKey();
  const done = store.load('geo_daily_done','')===today;
  const myScore = store.load('geo_daily_score', null);
  box.innerHTML =
    `<button class="primary-btn" id="btn-daily">${done?'✓ 오늘 완료 — 다시 풀기(연습)':'🔁 오늘의 도전 시작 (10문제)'}</button>`+
    (done&&myScore!=null?`<div class="daily-mine">오늘 내 기록: <b>${myScore}점</b></div>`:'')+
    `<div id="daily-board" class="daily-board"><div class="t-msg" style="margin:8px 0 0">오늘의 랭킹 불러오는 중…</div></div>`;
  $('btn-daily').onclick=()=>startGame('daily');
  fetchDaily(today).then(d=>{
    const el=$('daily-board'); if(!el) return;
    const list=(d&&d.top)||[];
    if(!list.length){ el.innerHTML='<div class="t-msg" style="margin:8px 0 0">아직 오늘 기록이 없어요. 첫 도전자가 되어 보세요!</div>'; return; }
    const medal=['🥇','🥈','🥉'];
    el.innerHTML='<div class="bd-head" style="margin-top:8px">오늘의 랭킹 TOP 5</div>'+
      list.slice(0,5).map((e,i)=>`<div class="bd-row"><span class="bd-rk">${medal[i]||(i+1)}</span><span class="bd-name">${e.name}</span><b class="bd-score">${e.score}점</b></div>`).join('');
  });
}

// ============================================================
// 🏅 업적 · 칭호 뱃지
// ============================================================
let ach = store.load('geo_ach', {});
const ACHIEVEMENTS=[
  {id:'first', icon:'🌱', name:'첫 발걸음', desc:'게임을 처음 완료', reward:5,  check:()=>xp>0},
  {id:'rank',  icon:'🗺️', name:'지도 읽는 자', desc:'XP 1600 달성', reward:10, check:()=>xp>=1600},
  {id:'combo15',icon:'⚡', name:'콤보 마스터', desc:'한 게임 15콤보', reward:15, check:()=>store.load('geo_maxcombo',0)>=15},
  {id:'streak10',icon:'🔥',name:'10연승', desc:'연승 모드 10연승', reward:15, check:()=>store.load('geo_beststreak',0)>=10},
  {id:'streak25',icon:'🌋',name:'연승 괴물', desc:'연승 모드 25연승', reward:30, check:()=>store.load('geo_beststreak',0)>=25},
  {id:'bingo', icon:'🧩', name:'빙고 블랙아웃', desc:'빙고판 25칸 완성', reward:20, check:()=>!!store.load('geo_bingo_black',false)},
  {id:'daily', icon:'🔁', name:'오늘의 도전자', desc:'일일 도전 완료', reward:10, check:()=>!!store.load('geo_daily_done','')},
  {id:'col50', icon:'📒', name:'수집가', desc:'지역 카드 50종 수집', reward:15, check:()=>Object.keys(cards).length>=50},
  {id:'col100',icon:'🏞️', name:'도감 마스터', desc:'지역 카드 100종 수집', reward:30, check:()=>Object.keys(cards).length>=100},
  {id:'legend',icon:'🏯', name:'세계유산 수집가', desc:'유네스코 도시 카드 획득', reward:15, check:()=>Object.keys(cards).some(n=>{const l=LOCATIONS.find(x=>x.name===n);return l&&hasUnesco(l);})},
  {id:'enh3', icon:'✨', name:'강화 입문', desc:'카드 1장 최종 강화(3단계)', reward:15, check:()=>Object.keys(cards).some(n=>cardLevel(n)>=CARD_MAX_LV)},
  {id:'enh5', icon:'🌟', name:'연성 마스터', desc:'카드 5장 최종 강화', reward:30, check:()=>Object.keys(cards).filter(n=>cardLevel(n)>=CARD_MAX_LV).length>=5},
  {id:'enh10',icon:'💫', name:'도감 연성가', desc:'카드 10장 최종 강화', reward:30, check:()=>Object.keys(cards).filter(n=>cardLevel(n)>=CARD_MAX_LV).length>=10},
  {id:'boss1', icon:'👹', name:'권역 정복자', desc:'권역 보스 1곳 격파', reward:15, check:()=>Object.keys(titles).length>=1},
  {id:'bossAll',icon:'👑',name:'국토 통일', desc:'모든 권역 보스 격파', reward:50, check:()=>BOSS_REGIONS.every(r=>titles[r])},
  {id:'attend7',icon:'📅',name:'개근상', desc:'7일 연속 출석', reward:20, check:()=>store.load('geo_streak',0)>=7},
];
function checkAchievements(){
  const newly=[];
  ACHIEVEMENTS.forEach(a=>{ if(!ach[a.id]){ let ok=false; try{ ok=a.check(); }catch(e){} if(ok){ ach[a.id]=true; newly.push(a); } } });
  if(newly.length){
    store.save('geo_ach', ach);
    const bonus=newly.reduce((s,a)=>s+(a.reward||0),0);
    if(bonus){ coins+=bonus; store.save('geo_coins',coins); updateGachaUI(); }
    achToast(newly, bonus);
    renderAchievements();
    scheduleSync();
  }
}
function achToast(list, bonus){
  const t=document.createElement('div'); t.className='ach-toast';
  t.innerHTML=`<div class="at-title">🏅 업적 달성!</div>`+
    list.map(a=>`<div class="at-row"><span class="at-ic">${a.icon}</span> ${a.name}</div>`).join('')+
    (bonus?`<div class="at-bonus">보너스 +${bonus}🪙</div>`:'');
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('show'),20);
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),400); }, 3400);
}
function renderAchievements(){
  const box=$('ach-list'); if(!box) return;
  const got=ACHIEVEMENTS.filter(a=>ach[a.id]).length;
  const cnt=$('ach-count'); if(cnt) cnt.textContent=`${got}/${ACHIEVEMENTS.length}`;
  box.innerHTML=ACHIEVEMENTS.map(a=>{
    const on=!!ach[a.id];
    return `<div class="ach-item${on?' on':''}"><span class="ach-ic">${on?a.icon:'🔒'}</span>`+
      `<div class="ach-txt"><b>${a.name}</b><small>${a.desc}</small></div></div>`;
  }).join('');
}

function startGame(mode, opt){
  G.mode=mode; G.idx=0; G.score=0; G.combo=0; G.maxCombo=0; G.correctCnt=0; G.locked=false;
  G.battle=null; G.bossRegion=null; G.noTimer=(mode==='streak'); G.lastCorrect=true;
  if(mode==='boss'){ G.bossRegion=opt; G.region=opt; }
  if(!svgBuilt){ buildMap(); initMapGestures(); }
  clearMapExtras(); resetView();
  stopArcade(); stopTimer(); clearMapTap();
  { const ms=$('map-svg'); if(ms) ms.onclick=null; }   // 탐색 모드 등 이전 클릭 핸들러 잔류 방지
  { const tip=$('warmup-tip'); if(tip) tip.classList.add('hidden'); }
  { const bb=$('boss-bar'); if(bb) bb.classList.toggle('hidden', mode!=='boss'); }

  const info=MODE_INFO[mode];
  $('screen-game').style.setProperty('--mode-c', MODE_COLOR[mode]||'#1278C2');
  $('game-title').textContent = mode==='boss'
    ? `👹 ${regionLabel(opt)} 보스전`
    : info.title+(G.region!=='전체'?` · ${G.region}`:'');
  $('turn-indicator').classList.add('hidden');
  $('map-pane').style.display=info.useMap?'block':'none';
  $('game-body').classList.toggle('no-map', !info.useMap);
  $('btn-next').classList.add('hidden');
  $('feedback-box').classList.add('hidden');

  if(mode==='explore') return startExplore();
  if(mode==='acidrain') return startAcidRain();
  if(mode==='runner') return startRunner();

  if(mode==='ox'){
    G.queue=shuffle(pool('ox'));
    G.oxEnd=Date.now()+60000;
  } else if(mode==='battle'){
    const types=['location','muniname','detective','climate','stats','mcq','ox'];
    let q=[];
    for(let i=0;i<MODE_INFO.battle.n;i++){
      const t=types[Math.floor(Math.random()*types.length)];
      const p=shuffle(pool(t));
      q.push({btype:t, item:p[i%p.length]});
    }
    G.queue=q;
    const n1=prompt('플레이어 1 이름?','P1')||'P1';
    const n2=prompt('플레이어 2 이름?','P2')||'P2';
    G.battle={turn:1, scores:[0,0], combos:[0,0], correct:[0,0], names:[n1.slice(0,8),n2.slice(0,8)]};
  } else if(mode==='location'||mode==='detective'){
    G.queue=sampleLocQueue(pool(mode), MODE_INFO[mode].n);
  } else if(mode==='wanted'){
    const wp=wantedPool();
    G.queue=sampleLocQueue(wp, Math.min(wp.length, MODE_INFO.wanted.n));
  } else if(mode==='muniname'){
    G.queue=weightedSample(pool(mode), MODE_INFO[mode].n, n=>n);
  } else if(mode==='boss'){
    G.queue=bossQueue(opt);
  } else if(mode==='bingo'){
    const cells=buildBingo();
    G.bingo={cells, wrong:0, lineKeys:new Set(), targetIdx:-1};
    G.queue=shuffle(cells.slice());
    renderBingoGrid();
  } else if(mode==='streak'){
    G.queue=streakRefill(30);
  } else if(mode==='daily'){
    G.queue=dailyQueue();
  } else if(mode==='theme'){
    const theme=themeByKey(opt) || buildThemes()[0];
    $('game-title').textContent=theme.label;
    const useMCQ = theme.key==='special';                 // 특산물은 지도 대신 4지선다
    const its=shuffle(theme.items).slice(0, Math.min(theme.items.length, MODE_INFO.theme.n));
    const allNames=theme.items.map(it=>it.a.replace(/\(.+\)$/,''));
    G.queue=its.map(it=>{ const mu=MUNIS[it.a];
      return {def:{label:theme.label}, mcq:useMCQ, siblings:allNames,
        loc:{name:it.a.replace(/\(.+\)$/,''), x:mu.cx, y:mu.cy, region:mu.region, accept:[it.a], fact:it.c}}; });
  } else {
    G.queue=shuffle(pool(mode)).slice(0, MODE_INFO[mode].n);
  }
  if(mode==='boss') hudUpdate();   // 보스 HP 초기 표시
  show('screen-game');
  nextQuestion();
}

function hudUpdate(){
  const total = (G.mode==='ox'||G.mode==='streak') ? '∞' : G.queue.length;
  $('hud-qnum').textContent=Math.min(G.idx+1, G.queue.length);
  $('hud-qtotal').textContent=total;
  if(G.battle){
    const b=G.battle;
    $('hud-combo').textContent=b.combos[b.turn-1];
    $('hud-score').textContent=`${b.names[0]} ${b.scores[0]} : ${b.scores[1]} ${b.names[1]}`;
    const ti=$('turn-indicator');
    ti.classList.remove('hidden','p1','p2');
    ti.classList.add(b.turn===1?'p1':'p2');
    ti.textContent=`▶ ${b.names[b.turn-1]} 차례`;
  } else {
    $('hud-combo').textContent=G.combo;
    $('hud-score').textContent=G.score;
  }
  if(G.mode==='boss'){
    const bb=$('boss-bar'); if(!bb) return;
    const max=G.queue.length, hp=Math.max(0, max-G.correctCnt), pct=Math.round(hp/max*100);
    const need=Math.ceil(max*0.7);
    bb.innerHTML=`<div class="boss-top"><span>👹 ${regionLabel(G.bossRegion)} 보스 HP</span>`+
      `<span>${hp}/${max} · ${need}타 격파</span></div>`+
      `<div class="boss-hp"><div class="boss-hp-fill" style="width:${pct}%"></div></div>`;
  }
}

// ---------- 타이머 ----------
function startTimer(sec, onTimeout){
  stopTimer();
  const wrap=$('timer-bar-wrap');
  if(G.noTimer){   // 🔥 연승 모드: 시간 제한 없음 — 타이머 바 숨김, 타임아웃 없음
    if(wrap) wrap.style.display='none';
    const t=$('warmup-tip'); if(t) t.classList.add('hidden');
    return;
  }
  if(wrap) wrap.style.display='';
  // 런 첫 문항 워밍업(지도 조작 모드만): 시간 넉넉하게 + 안내 배지
  const warm = G.idx===0 && WARMUP_MODES.has(G.mode);
  if(warm) sec = Math.round(sec*WARMUP_MULT)+WARMUP_ADD;
  const tip=$('warmup-tip');
  if(tip){
    tip.classList.toggle('hidden', !warm);
    if(warm) tip.textContent='🔰 연습 감각 — 첫 문제는 시간이 넉넉해요. 확대·이동·탭을 익혀 보세요!';
  }
  G.timeMax=sec; G.timeLeft=sec;
  const bar=$('timer-bar');
  bar.style.width='100%'; bar.classList.remove('danger');
  G.timer=setInterval(()=>{
    G.timeLeft-=0.1;
    const pct=Math.max(0,G.timeLeft/G.timeMax*100);
    bar.style.width=pct+'%';
    if(pct<30) bar.classList.add('danger');
    if(G.timeLeft<=0){ stopTimer(); onTimeout(); }
  },100);
}
function stopTimer(){ if(G.timer){ clearInterval(G.timer); G.timer=null; } }
function timeBonus(){ return G.noTimer||!G.timeMax ? 0 : Math.round(Math.max(0,G.timeLeft)/G.timeMax*50); }

// ---------- 점수 ----------
const WRONG_PENALTY = 30;          // 오답 시 감점(점수가 마이너스가 될 수도 있음)
function award(correct, base){
  let pts=0;
  if(G.battle){
    const i=G.battle.turn-1;
    if(correct){
      G.battle.combos[i]++; G.battle.correct[i]++;
      pts=base+timeBonus()+G.battle.combos[i]*10;
      G.battle.scores[i]+=pts;
    } else { G.battle.combos[i]=0; pts=-WRONG_PENALTY; G.battle.scores[i]+=pts; }
  } else {
    G.lastCorrect=correct;
    if(correct){
      G.combo++; G.maxCombo=Math.max(G.maxCombo,G.combo); G.correctCnt++;
      pts=base+timeBonus()+G.combo*10;
      G.score+=pts;
    } else { G.combo=0; pts=-WRONG_PENALTY; G.score+=pts; }
    missionProgress({mode:G.mode, correct, combo:G.combo});
  }
  return pts;
}
function recordStat(region, correct){
  if(!region) return;
  const s=stats[region]||(stats[region]={c:0,t:0});
  s.t++; if(correct) s.c++;
  store.save('geo_stats',stats);
  missionProgress({region, correct});
}

// --- 오답 지역 수배서 ---
// 시·군 위치 모드(위치 사냥·지역 판독·추리)에서 그 시·군을 정확히 맞혔는지(hit)를 기록.
// 틀리면 수배 등록(miss 누적, 3회↑ '위험'), 2연속 정답이면 수배 해제.
function logResult(muni, hit){
  if(!muni) return;
  if(hit){
    const w=wanted[muni];
    if(!w) return;                       // 수배 중이 아니면 무시
    w.streak=(w.streak||0)+1;
    if(w.streak>=2) delete wanted[muni]; // 2연속 정답 → 해제
  } else {
    const w=wanted[muni]||(wanted[muni]={miss:0,streak:0});
    w.miss++; w.streak=0;
  }
  store.save('geo_wanted',wanted);
  missionProgress({muni, correct:hit});
}
// 시·군 정식키(예: '태백시') → 짧은 표시명(예: '태백')
function muniShort(muni){
  const l=LOCATIONS.find(x=>x.accept.includes(muni));
  return (l&&l.name) || muni.replace(/(특별자치시|특별자치도|광역시|특별시|자치시|자치도|시|군)$/,'');
}
// 수배 중인 시·군을 위치 사냥 형식으로 풀 수 있게 loc 객체 목록 생성
function wantedPool(){
  return Object.keys(wanted).map(muni=>{
    const l=LOCATIONS.find(x=>x.accept.includes(muni));
    if(l) return l;
    const mu=MUNIS[muni]; if(!mu) return null;   // LOCATION 없는 시·군은 즉석 생성
    return {name:muniShort(muni), x:mu.cx, y:mu.cy, region:mu.region, accept:[muni],
            fact:`${mu.prov} ${muniShort(muni)} — 지도에서 위치를 다시 확인하세요.`};
  }).filter(Boolean);
}

// ============================================================
// 🎯 오늘의 지리 미션 — 매일 3개, 깨면 코인·XP 보상 (날짜 시드 → 모두 같은 미션)
// ============================================================
const MISSION_POOL = [
  {id:'reg-jeju',  label:'제주권 문제 5개 맞히기',  goal:5, type:'solve', region:'제주',   reward:{c:5,x:40}},
  {id:'reg-gw',    label:'강원권 문제 6개 맞히기',  goal:6, type:'solve', region:'강원',   reward:{c:5,x:40}},
  {id:'reg-honam', label:'호남권 문제 6개 맞히기',  goal:6, type:'solve', region:'호남',   reward:{c:5,x:40}},
  {id:'reg-chung', label:'충청권 문제 6개 맞히기',  goal:6, type:'solve', region:'충청',   reward:{c:5,x:40}},
  {id:'reg-yeong', label:'영남권 문제 6개 맞히기',  goal:6, type:'solve', region:'영남',   reward:{c:5,x:40}},
  {id:'reg-sudo',  label:'수도권 문제 6개 맞히기',  goal:6, type:'solve', region:'수도권', reward:{c:5,x:40}},
  {id:'mode-clim', label:'기후 비교 3문제 맞히기',  goal:3, type:'mode',  mode:'climate', reward:{c:6,x:45}},
  {id:'mode-stat', label:'통계 비교 3문제 맞히기',  goal:3, type:'mode',  mode:'stats',   reward:{c:6,x:45}},
  {id:'mode-loc',  label:'위치 사냥 8문제 맞히기',  goal:8, type:'mode',  mode:'location',reward:{c:6,x:45}},
  {id:'card-new',  label:'지역 카드 1장 새로 획득', goal:1, type:'card',  reward:{c:4,x:30}},
  {id:'freq-top',  label:'빈출 TOP10 지역 중 3곳 맞히기', goal:3, type:'freq', reward:{c:8,x:60}},
  {id:'combo7',    label:'한 게임에서 7콤보 달성',  goal:7, type:'combo', reward:{c:6,x:50}},
];
const MISSION_N = 3;
function missionDef(id){ return MISSION_POOL.find(m=>m.id===id); }
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function pickMissions(dateStr, k){
  let seed=hashStr(dateStr)||1;
  const rnd=()=>{ seed^=seed<<13; seed^=seed>>>17; seed^=seed<<5; seed>>>=0; return seed/4294967296; };
  const idx=MISSION_POOL.map((_,i)=>i);
  for(let i=idx.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
  return idx.slice(0,k).map(i=>({id:MISSION_POOL[i].id, prog:0, done:false, claimed:false, seen:[]}));
}
let mission = store.load('geo_mission', null);
function ensureMission(){
  const t=new Date().toDateString();
  if(!mission || mission.date!==t){
    mission={date:t, list:pickMissions(t, MISSION_N)};
    store.save('geo_mission', mission);
  }
  return mission;
}
let FREQ_TOP_SET=null;
function freqTopSet(){
  if(FREQ_TOP_SET) return FREQ_TOP_SET;
  const METRO=/(특별시|광역시|특별자치시)$/;
  FREQ_TOP_SET=new Set(Object.entries(FREQ)
    .filter(([n])=>MUNIS[n]&&!METRO.test(n))
    .sort((a,b)=>b[1].count-a[1].count).slice(0,10).map(([n])=>n));
  return FREQ_TOP_SET;
}
// 미션 진행도 갱신 — 출처별로 필드가 달라 미션 유형 간 중복 집계 없음
//   award()    → {mode, correct, combo}   (문항당 1회)
//   recordStat → {region, correct}
//   logResult  → {muni, correct}          (빈출 시·군)
//   drawCard   → {isNew}
function missionProgress(ev){
  ensureMission();
  let changed=false;
  for(const it of mission.list){
    if(it.done) continue;
    const d=missionDef(it.id); if(!d) continue;
    if(d.type==='solve'  && ev.region===d.region && ev.correct) { it.prog++; changed=true; }
    else if(d.type==='mode' && ev.mode===d.mode && ev.correct)  { it.prog++; changed=true; }
    else if(d.type==='card' && ev.isNew)                        { it.prog++; changed=true; }
    else if(d.type==='combo' && typeof ev.combo==='number')     { if(ev.combo>it.prog){ it.prog=ev.combo; changed=true; } }
    else if(d.type==='freq' && ev.muni && ev.correct && freqTopSet().has(ev.muni)){
      if(!it.seen.includes(ev.muni)){ it.seen.push(ev.muni); it.prog++; changed=true; }
    }
    if(it.prog>=d.goal && !it.done){ it.done=true; changed=true; }
  }
  if(changed){
    store.save('geo_mission', mission);
    if($('mission-body') && $('screen-home')?.classList.contains('active')) renderMission();
  }
}
function claimMission(id){
  const it=mission&&mission.list.find(x=>x.id===id);
  if(!it || !it.done || it.claimed) return;
  const d=missionDef(id); if(!d) return;
  it.claimed=true; store.save('geo_mission', mission);
  coins=num(coins)+num(d.reward&&d.reward.c); store.save('geo_coins', coins);
  xp=num(xp)+num(d.reward&&d.reward.x); store.save('geo_xp', xp);
  updateGachaUI();
  renderMission();
  scheduleSync();
}

// ---------- 진행 ----------
function nextQuestion(){
  G.locked=false;
  clearMapTap();
  $('feedback-box').classList.add('hidden');
  $('btn-next').classList.add('hidden');
  clearMapExtras();
  try{ window.scrollTo(0,0); }catch(e){}   // 새 문제는 항상 상단(상단 바·문제)부터 보이도록
  // 문제 전환 시 지도를 즉시 원위치 (비교 모드는 이후 자체적으로 자동 확대)
  if(viewAnimId){ cancelAnimationFrame(viewAnimId); viewAnimId=null; }
  view={...VIEW0}; applyView();

  if(G.mode==='ox'){
    if(Date.now()>=G.oxEnd || G.idx>=G.queue.length) return endGame();
  } else if(G.mode==='streak'){
    if(G.idx>=G.queue.length-2) G.queue=G.queue.concat(streakRefill(30));   // 끝없이 보충
  } else if(G.idx>=G.queue.length) return endGame();

  hudUpdate();
  let item=G.queue[G.idx], type=G.mode;
  if(G.mode==='battle'||G.mode==='boss'||G.mode==='streak'||G.mode==='daily'){
    type=item.btype; item=item.item;
    const noMap=(type==='mcq'||type==='ox'||(type==='climate'&&item.kind==='order'));
    $('map-pane').style.display=noMap?'none':'block';
    $('game-body').classList.toggle('no-map', noMap);
  }
  if(G.mode==='climate'){   // 순서형은 지도 불필요
    const noMap=item.kind==='order';
    $('map-pane').style.display=noMap?'none':'block';
    $('game-body').classList.toggle('no-map', noMap);
  }
  if(G.mode==='theme'){     // 특산물 등 4지선다 테마는 지도 불필요
    const noMap=!!item.mcq;
    $('map-pane').style.display=noMap?'none':'block';
    $('game-body').classList.toggle('no-map', noMap);
  }

  G.curType=type;   // 현재 문제 유형(혼합 모드 대비) — 피드백 안내 조건 등에 사용
  if(type==='location'||type==='wanted') askLocation(item);
  else if(type==='bingo') askBingo(item);
  else if(type==='theme') item.mcq ? askThemeMCQ(item) : askTheme(item);
  else if(type==='muniname') askMuniName(item);
  else if(type==='detective') askDetective(item);
  else if(type==='climate') askClimate(item);
  else if(type==='stats') askStats(item);
  else if(type==='mcq') askMCQ(item);
  else if(type==='ox') askOX(item);
}

function afterAnswer(){
  G.idx++;
  if(G.battle) G.battle.turn = G.battle.turn===1?2:1;
  if(G.mode==='streak' && !G.lastCorrect){ $('btn-next').classList.add('hidden'); setTimeout(()=>endGame(), 1300); return; }
  if(G.mode==='ox'){ setTimeout(nextQuestion, 900); }
  else $('btn-next').classList.remove('hidden');
}
$('btn-next').onclick=nextQuestion;

// 학습 부가 정보: 기출 빈도 + 출제 경향 + 이미지 자료 링크
function studyExtra(name){
  const f=freqInfo(name), n=noteOf(name);
  let h='';
  if(f) h+=`<div class="fb-extra">🔥 최근 5개년 기출 <b>${f.count}회</b> 언급 (${f.exams}개 시험)</div>`;
  if(n) h+=`<div class="fb-extra">📌 ${n}</div>`;
  h+=`<div class="fb-extra">${imgSearchLink(name)}</div>`;
  return h;
}

// 점수 +N 튀어오름 (HUD 점수 위)
function scorePop(pts){
  const host=document.querySelector('.hud .score'); if(!host||!pts) return;
  const el=document.createElement('span');
  el.className='score-pop'+(pts<0?' minus':''); el.textContent=(pts>0?'+':'')+pts;
  host.appendChild(el);
  setTimeout(()=>el.remove(), 1000);
}
const MASCOT_VER='?v=20260615j';
function feedback(correct, head, body, pts){
  const fb=$('feedback-box');
  // 콤보 칭찬
  const combo = G.battle ? G.battle.combos[G.battle.turn-1] : G.combo;
  let flair='';
  if(correct && combo>=2){
    flair = combo>=7 ? ` · ${combo}연속! 지도가 머릿속에 있다 🗺️✨`
          : combo>=5 ? ` · ${combo}연속! 지리 감각 폭발 🔥🔥`
          : combo>=3 ? ` · ${combo}연속 🔥` : ` · ${combo}연속!`;
  }
  const face=`<img class="fb-mascot ${correct?'happy':'sad'}" src="${correct?'guide-correct.png':'guide-think.png'}${MASCOT_VER}" alt="">`;
  fb.className='feedback-box '+(correct?'good':'bad');
  const ptsTag = pts ? ` <span class="fb-pts${pts<0?' minus':''}">${pts>0?'+':''}${pts}점</span>` : '';
  const REGION_TAP_TYPES=['location','wanted','theme','muniname','detective','bingo'];
  const note = (!correct && REGION_TAP_TYPES.includes(G.curType))
    ? '<div class="fb-note">📌 이 지역은 [미션] 탭 ‘오답 수배서’에 등록됐어요 — 나중에 복습!</div>' : '';
  fb.innerHTML=`<div class="fb-head">${face}${head}${flair}${ptsTag}</div>${body}${note}`;
  fb.classList.remove('hidden'); fb.classList.add('pop');
  setTimeout(()=>fb.classList.remove('pop'),400);
  if(pts) scorePop(pts);
  // 모바일: 해설이 보이도록 자동 스크롤 + 가벼운 진동
  if(window.innerWidth<=820){
    setTimeout(()=>fb.scrollIntoView({behavior:'smooth', block:'center'}),60);
  }
  try { if(navigator.vibrate) navigator.vibrate(correct?25:[50,40,50]); } catch(e){}
}

// ============================================================
// 모드별 출제
// ============================================================
// --- 위치 사냥: 이름형 + 설명형(특징을 보고 추론) 혼합 ---
function askLocation(loc){
  const info=MODE_INFO[G.mode];
  // 설명형 비중 높게(약 65%) — 마스코트 항목은 항상 설명형
  const descForm = loc.descOnly || (loc.fact && loc.fact.length>=18 && Math.random()<0.65);
  const imageForm = !!loc.image && (loc.imageOnly || loc.descOnly || Math.random()<0.45);
  if(descForm){
    const descText = maskName(loc.desc || loc.fact, loc);
    const caption = loc.mascotName ? `〈마스코트 ‘${loc.mascotName}’〉` : '〈지자체 캐릭터〉';
    const imageHTML = imageForm
      ? `<div class="mascot-clue"><img src="${escapeAttr(loc.image)}?v=2" alt="지자체 캐릭터 이미지" loading="eager"><div class="mascot-cap">${caption}</div></div>`
      : '';
    $('question-box').innerHTML=
      `<span class="q-region">${regionLabel(loc.region)}</span> ${imageForm?'다음 설명과 캐릭터에 해당하는 지역은? 지도에서 콕!':'어느 지역일까? 지도에서 콕! 찍어 보자'}`+
      `<div class="stat-card" style="font-weight:600">${descText}</div>`+
      imageHTML;
  } else {
    $('question-box').innerHTML=
      `<span class="q-region">${regionLabel(loc.region)}</span> 지도에서 <b style="color:var(--sea-d);font-size:1.2em">${loc.name}</b> ${loc.accept.length>1?'일대':'(이/가) 속한 시·군'}를 탭하세요!`;
  }
  $('choices-box').innerHTML='<div class="map-hint">💡 작으면 확대해서 콕! 가까우면 절반 점수</div>';
  if(G.region!=='전체' && G.mode!=='daily') dimOtherRegions(G.region);
  fitRegion(loc.region);                 // 출제 권역으로 자동 확대

  const reveal=()=>{
    loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));
    addDot(loc.x,loc.y,5,'loc-dot target-reveal');
    addLabel(loc.x,loc.y-10,loc.name);
  };
  const off=onMuniTap((t,e)=>{
    G.locked=true; stopTimer();
    const tapped=t.dataset.name;
    const p=svgPoint(e.clientX,e.clientY);
    const d=Math.hypot(p.x-loc.x, p.y-loc.y);
    let correct=false, base=0, head='';
    const exact=loc.accept.includes(tapped);          // 정확히 그 시·군을 탭했는지(수배서 판정 기준)
    const baseFull = descForm ? 140 : 120;            // 설명형은 더 높은 점수
    if(exact){ correct=true; base=baseFull; head='🎯 정확해요!'; }
    else if(d<=55){ correct=true; base=Math.round(baseFull/2); head=`👍 근접! (${tapped} 탭, 절반 점수)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    else { head=`❌ 아쉬워요 (${tapped} 탭)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    reveal();
    const pts=award(correct,base);
    recordStat(loc.region,correct);
    logResult(loc.accept[0], exact);
    feedback(correct,head,`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),pts);
    hudUpdate(); afterAnswer();
  });
  startTimer(info.time||18,()=>{ if(G.locked)return; G.locked=true; off();
    reveal();
    award(false,0); recordStat(loc.region,false); logResult(loc.accept[0], false);
    feedback(false,'⏰ 아깝다, 시간 초과!',`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name),0);
    hudUpdate(); afterAnswer();
  });
}

// --- 🏷️ 테마 게임: 테마(도청·혁신도시·기업도시·축제 등)에 해당하는 지역을 전국 지도에서 탭 ---
function askTheme(item){
  const info=MODE_INFO[G.mode];
  const {def, loc}=item;
  const descText=maskName(loc.fact, loc);
  $('question-box').innerHTML=
    `<span class="q-region">${def.label}</span> 이 테마에 해당하는 지역을 지도에서 탭하세요!`+
    `<div class="stat-card" style="font-weight:600">${descText}</div>`;
  $('choices-box').innerHTML='<div class="map-hint">💡 전국 지도에서 찾아 탭! 작으면 확대(＋), 가까우면 절반 점수</div>';
  // 테마는 전국 대상 → 전체 지도(권역 dim·확대 없음, nextQuestion이 이미 전체 뷰로 리셋)
  const reveal=()=>{
    loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));
    addDot(loc.x,loc.y,5,'loc-dot target-reveal');
    addLabel(loc.x,loc.y-10,loc.name);
  };
  const exp=()=>`${def.label} — <b>${loc.name}</b> · ${loc.fact}`+studyExtra(loc.name);
  const off=onMuniTap((t,e)=>{
    G.locked=true; stopTimer();
    const tapped=t.dataset.name;
    const p=svgPoint(e.clientX,e.clientY);
    const d=Math.hypot(p.x-loc.x, p.y-loc.y);
    const exact=loc.accept.includes(tapped);
    let correct=false, base=0, head='';
    if(exact){ correct=true; base=130; head='🎯 정확해요!'; }
    else if(d<=55){ correct=true; base=65; head=`👍 근접! (${tapped} 탭, 절반 점수)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    else { head=`❌ 아쉬워요 (${tapped} 탭)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    reveal();
    const pts=award(correct,base);
    recordStat(loc.region,correct);
    logResult(loc.accept[0], exact);
    feedback(correct, head, exp(), pts);
    hudUpdate(); afterAnswer();
  });
  startTimer(info.time||30,()=>{ if(G.locked)return; G.locked=true; off();
    reveal();
    award(false,0); recordStat(loc.region,false); logResult(loc.accept[0], false);
    feedback(false,'⏰ 아깝다, 시간 초과!', exp(), 0);
    hudUpdate(); afterAnswer();
  });
}

// --- 테마(특산물): 지도 대신 4지선다로 주산지를 고른다 ---
function askThemeMCQ(item){
  const info=MODE_INFO[G.mode];
  const {def, loc, siblings}=item;
  const answer=loc.name;
  const distract=shuffle((siblings||[]).filter(n=>n!==answer)).slice(0,3);
  const opts=shuffle([answer, ...distract]);
  $('question-box').innerHTML=
    `<span class="q-region">${def.label}</span> 다음 특산물의 주산지로 옳은 지역은?`+
    `<div class="stat-card" style="font-weight:600">${loc.fact}</div>`;
  const box=$('choices-box'); box.innerHTML='';
  const exp=()=>`${def.label} — <b>${answer}</b> · ${loc.fact}`+studyExtra(answer);
  const finish=(correct, head, btn)=>{
    box.querySelectorAll('button').forEach(b=>{ b.disabled=true;
      if(b.textContent===answer) b.classList.add('correct');
      else if(b===btn) b.classList.add('wrong'); });
    const pts=award(correct, 120);
    recordStat(loc.region, correct);
    logResult(loc.accept[0], correct);
    feedback(correct, head, exp(), pts);
    hudUpdate(); afterAnswer();
  };
  opts.forEach(o=>{
    const b=document.createElement('button');
    b.className='choice-btn'; b.textContent=o;
    b.onclick=()=>{ if(G.locked)return; G.locked=true; stopTimer();
      finish(o===answer, o===answer?'🎯 정답!':`❌ 아쉬워요 — 정답은 ${answer}`, b); };
    box.appendChild(b);
  });
  startTimer(info.time||30,()=>{ if(G.locked)return; G.locked=true;
    finish(false,'⏰ 아깝다, 시간 초과!', null); });
}

// --- 🧩 빙고 게임: 5×5 지역명 빙고판, 설명에 맞는 칸을 순차 선택. 2회 오답 시 강제 종료 ---
function bingoLabel(muni){ return muni.replace(/\(.+\)$/,'').replace(/(특별자치시|특별시|광역시)$/,''); }
function buildBingo(){
  const seen=new Set(), uniq=[];
  shuffle(locPool().slice()).forEach(l=>{
    const k=l.accept&&l.accept[0]; if(!k||seen.has(k)) return;
    const raw=l.desc||l.fact; if(!raw) return;
    seen.add(k);
    uniq.push({region:l.region, name:bingoLabel(k), accept:l.accept, raw, clue:maskName(raw,l), done:false});
  });
  return uniq.slice(0,25);
}
function renderBingoGrid(){
  const box=$('choices-box');
  box.innerHTML='<div class="bingo-grid" id="bingo-grid"></div>';
  const grid=$('bingo-grid');
  G.bingo.cells.forEach((cell,i)=>{
    const b=document.createElement('button');
    b.className='bingo-cell'; b.dataset.i=i;
    b.innerHTML=`<span>${cell.name}</span>`;
    b.onclick=()=>bingoTap(i);
    grid.appendChild(b);
  });
}
function bingoCellEl(i){ return document.querySelector(`.bingo-cell[data-i="${i}"]`); }
function bingoLines(){
  const c=G.bingo.cells, done=i=>c[i].done, lines=[];
  for(let r=0;r<5;r++) lines.push(['R'+r,[0,1,2,3,4].map(k=>r*5+k)]);
  for(let k=0;k<5;k++) lines.push(['C'+k,[0,1,2,3,4].map(r=>r*5+k)]);
  lines.push(['D0',[0,6,12,18,24]]); lines.push(['D1',[4,8,12,16,20]]);
  let neu=0;
  lines.forEach(([key,idxs])=>{
    if(idxs.every(done) && !G.bingo.lineKeys.has(key)){
      G.bingo.lineKeys.add(key); neu++;
      idxs.forEach(i=>bingoCellEl(i)?.classList.add('line'));
    }
  });
  return neu;
}
function askBingo(cell){
  const info=MODE_INFO.bingo;
  G.bingo.targetIdx=G.bingo.cells.indexOf(cell);
  $('question-box').innerHTML=
    `<span class="q-region">${regionLabel(cell.region)}</span> 설명에 맞는 지역을 빙고판에서 찾아 탭!`+
    `<span class="bingo-strike">❌ ${G.bingo.wrong}/2</span>`+
    `<div class="stat-card" style="font-weight:600">${cell.clue}</div>`;
  startTimer(info.time||22, ()=>{ if(G.locked)return; G.locked=true; bingoResolve(false,-1); });
}
function bingoTap(i){
  if(G.locked) return;
  if(G.bingo.cells[i].done && i!==G.bingo.targetIdx) return;   // 이미 채운 칸 오탭은 무시(관대)
  G.locked=true; stopTimer();
  bingoResolve(i===G.bingo.targetIdx, i);
}
function bingoResolve(correct, tappedIdx){
  const ti=G.bingo.targetIdx, target=G.bingo.cells[ti];
  let head, pts=0;
  if(correct){
    target.done=true; bingoCellEl(ti)?.classList.add('done');
    pts=award(true,90);
    const nl=bingoLines();
    if(nl>0){ const bonus=50*nl; G.score+=bonus; pts+=bonus; scorePop(bonus); }
    head=`🎯 정답! ${target.name}`+(nl>0?` · 🎉 빙고 ${nl}줄! +${50*nl}`:'');
  } else {
    G.bingo.wrong++;
    if(tappedIdx>=0) bingoCellEl(tappedIdx)?.classList.add('miss-pick');
    bingoCellEl(ti)?.classList.add('target');
    pts=award(false,0);
    head = tappedIdx<0 ? `⏰ 시간 초과! 정답은 ${target.name}` : `❌ 오답! 정답은 ${target.name}`;
  }
  recordStat(target.region, correct);
  logResult(target.accept[0], correct);
  const sc=document.querySelector('.bingo-strike'); if(sc) sc.textContent=`❌ ${G.bingo.wrong}/2`;
  feedback(correct, head, `<b>${target.name}</b> · ${target.raw}`+studyExtra(target.name), pts);
  hudUpdate();
  if(G.bingo.wrong>=2 && !correct){      // 2회 오답 → 강제 종료
    G.idx++; $('btn-next').classList.add('hidden');
    setTimeout(()=>endGame(), 1500);
  } else {
    afterAnswer();
  }
}

// --- 지역 추리: 힌트를 하나씩 열며 지역을 추리해 탭 (힌트를 아낄수록 고득점) ---
function buildHints(loc){
  const muniName=loc.accept[0].replace(/\(.+\)$/,'');
  const kind=muniName.endsWith('군')?'군(郡)':muniName.match(/(광역시|특별시|특별자치시)$/)?'광역 도시':'도시';
  const prov=MUNIS[loc.accept[0]]?.prov||'';
  const h1=`${loc.region} 지방의 ${kind}`;
  // 설명을 의미 단위로 잘라 힌트 2~3개 구성 (괄호·숫자 보호, 단어 중간 잘림 방지)
  const masked=maskName(loc.desc||loc.fact, loc);
  const parts=splitFact(masked).filter(s=>s.length>=4);
  let h2, h3;
  if(parts.length>=2){
    h2=parts[0]; h3=parts.slice(1).join(', ');
  } else {
    // 한 덩어리 설명: 절반 근처의 공백(단어 경계)에서 분할
    const words=masked.split(' ');
    if(words.length>=4){
      const cut=Math.ceil(words.length/2);
      h2=words.slice(0,cut).join(' ')+' …';
      h3=masked;
    } else {
      h2=masked; h3=masked;   // 너무 짧으면 그대로
    }
  }
  return [h1, h2, h3+(prov?` (${prov})`:'')];
}
function askDetective(loc){
  const info=MODE_INFO[G.mode];
  const hints=buildHints(loc);
  let revealed=1;
  const HINT_COST=40, BASE=170;
  const renderQ=()=>{
    $('question-box').innerHTML=
      `<span class="q-region">지역 추리</span> 힌트로 지역을 추리해 지도에서 탭하세요! <span class="map-hint">힌트를 아낄수록 +점수</span>`+
      `<ol class="hint-list">${hints.slice(0,revealed).map(h=>`<li>${h}</li>`).join('')}</ol>`;
  };
  renderQ();
  const renderChoices=()=>{
    $('choices-box').innerHTML='';
    if(revealed<hints.length){
      const b=document.createElement('button');
      b.className='ghost-btn hint-btn';
      b.textContent=`💡 힌트 ${revealed+1} 열기 (-${HINT_COST}점)`;
      b.onclick=()=>{ if(G.locked) return; revealed++; renderQ(); renderChoices(); };
      $('choices-box').appendChild(b);
    } else {
      $('choices-box').innerHTML='<div class="map-hint">모든 힌트 공개! 이제 지도를 탭하세요</div>';
    }
  };
  renderChoices();
  if(G.region!=='전체' && G.mode!=='daily') dimOtherRegions(G.region);
  fitRegion(loc.region);                 // 출제 권역으로 자동 확대

  const reveal=()=>{
    loc.accept.forEach(n=>muniEl(n)?.classList.add('correct','hit'));
    addDot(loc.x,loc.y,5,'loc-dot target-reveal');
    addLabel(loc.x,loc.y-10,loc.name);
  };
  const expBody=()=>`<b>${loc.name}</b> — ${loc.fact}`+studyExtra(loc.name.replace(/\(.+\)$/,''));
  const handler=(e)=>{
    if(suppressTap||G.locked) return;
    const t=e.target.closest('.muni');
    if(!t) return;
    G.locked=true; clearMapTap(); stopTimer();
    const tapped=t.dataset.name;
    const p=svgPoint(e.clientX,e.clientY);
    const d=Math.hypot(p.x-loc.x, p.y-loc.y);
    const baseFull=Math.max(60, BASE-(revealed-1)*HINT_COST);
    let correct=false, base=0, head='';
    const exact=loc.accept.includes(tapped);
    if(exact){ correct=true; base=baseFull; head=`🕵️ 명추리! (힌트 ${revealed}개)`; }
    else if(d<=55){ correct=true; base=Math.round(baseFull/2); head=`👍 근접! (${tapped} 탭, 절반 점수)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    else { head=`❌ 아쉬워요 (${tapped} 탭)`; t.classList.add('wrong'); labelWrongMuni(tapped); }
    reveal();
    const pts=award(correct,base);
    recordStat(loc.region,correct);
    logResult(loc.accept[0], exact);
    feedback(correct,head,expBody(),pts);
    hudUpdate(); afterAnswer();
  };
  setMapTap(handler);
  startTimer(info.time||40,()=>{ if(G.locked)return; G.locked=true; clearMapTap();
    reveal(); award(false,0); recordStat(loc.region,false); logResult(loc.accept[0], false);
    feedback(false,'⏰ 아깝다, 시간 초과!',expBody(),0);
    hudUpdate(); afterAnswer();
  });
}

// --- 지역 판독: 하이라이트된 시·군의 이름 맞히기 ---
function askMuniName(name){
  const info=MODE_INFO[G.mode];
  const m=MUNIS[name];
  $('question-box').innerHTML=
    `<span class="q-region">${m.region}</span> 지도에 <b style="color:var(--accent)">깜빡이는 시·군</b>의 이름은? <span class="map-hint">(${m.prov})</span>`;
  muniEl(name)?.classList.add('flash','pulse');
  if(G.region!=='전체' && G.mode!=='daily') dimOtherRegions(G.region);
  // 출제 시·군 주변으로 자동 확대 (이미 깜빡임으로 공개된 상태)
  {
    const bb=muniBBox(name);
    fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}], Math.max(bb.w,bb.h)*0.9+40);
  }
  // 같은 시·도 내에서 오답 3개
  const sib=shuffle(Object.keys(MUNIS).filter(n=>n!==name&&MUNIS[n].prov===m.prov));
  let opts=sib.slice(0,3);
  if(opts.length<3) opts=opts.concat(shuffle(Object.keys(MUNIS).filter(n=>n!==name&&!opts.includes(n))).slice(0,3-opts.length));
  const choices=shuffle([name,...opts]);

  const box=$('choices-box'); box.innerHTML='<div class="choices-grid2"></div>';
  const grid=box.firstChild;
  choices.forEach(n=>{
    const b=document.createElement('button');
    b.className='choice-btn'; b.textContent=n.replace(/\(.+\)$/,'');
    b.dataset.n=n;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      grid.querySelectorAll('button').forEach(x=>x.disabled=true);
      const correct=n===name;
      b.classList.add(correct?'correct':'wrong');
      if(!correct) grid.querySelectorAll('button').forEach(x=>{ if(x.dataset.n===name) x.classList.add('correct'); });
      muniEl(name)?.classList.remove('pulse');
      muniEl(name)?.classList.add('correct');
      if(correct) muniEl(name)?.classList.add('hit');
      const pts=award(correct,100);
      recordStat(m.region,correct);
      logResult(name, correct);
      feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`<b>${name}</b> (${m.prov})`+studyExtra(name.replace(/\(.+\)$/,'')),pts);
      hudUpdate(); afterAnswer();
    };
    grid.appendChild(b);
  });
  startTimer(info.time||15,()=>{ if(G.locked)return; G.locked=true;
    grid.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.n===name) x.classList.add('correct'); });
    muniEl(name)?.classList.remove('pulse'); muniEl(name)?.classList.add('correct');
    award(false,0); recordStat(m.region,false); logResult(name, false);
    feedback(false,'⏰ 아깝다, 시간 초과!',`<b>${name}</b> (${m.prov})`,0);
    hudUpdate(); afterAnswer();
  });
}

// --- 기후 판별: 실제 평년값 그래프를 보고 지역 맞히기 ---
function climateIndicators(st){
  const tmin=Math.min(...st.t), tmax=Math.max(...st.t);
  const total=st.p.reduce((a,b)=>a+b,0);
  const summer=st.p[5]+st.p[6]+st.p[7];                 // 6~8월
  const winter=st.p[11]+st.p[0]+st.p[1];                // 12~2월
  return {tmin, tmax, range:+(tmax-tmin).toFixed(1), total:Math.round(total),
          sRate:Math.round(summer/total*100), wRate:Math.round(winter/total*100)};
}
// ----- 2지역 비교용 차트 렌더러들 (유형 다양화) -----
// 묶음 막대: 지표별로 (가)(나) 막대 비교
function renderPairBars(rows, metas, labels){
  labels = labels || ['(가)','(나)'];
  const W=330, H=46+metas.length*58;
  let body='';
  metas.forEach((m,mi)=>{
    const v=[rows[0].v[mi], rows[1].v[mi]];
    const max=Math.max(...v.map(Math.abs), 1e-9);
    const y0=40+mi*58;
    body+=`<text x="10" y="${y0}" font-size="10" font-weight="700" fill="#1B4F8F">${m.label}(${m.unit})</text>`;
    v.forEach((val,i)=>{
      const bw=Math.max(6, Math.abs(val)/max*180);
      const y=y0+8+i*18;
      body+=`<text x="10" y="${y+11}" font-size="10" font-weight="800" fill="#2C4A66">${labels[i]}</text>`+
        `<rect x="38" y="${y}" width="${bw.toFixed(1)}" height="13" rx="4" fill="${i===0?'#20A2EE':'#A4CE4E'}"/>`+
        `<text x="${(42+bw).toFixed(1)}" y="${y+11}" font-size="10" fill="#6E93AE">${val}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="18" font-size="9" fill="#98B9CE">자료 비교</text>${body}</svg>`;
}
// 도표: 수능식 표
function renderPairTable(rows, metas, labels){
  labels = labels || ['(가)','(나)'];
  const tr=metas.map((m,mi)=>
    `<tr><td>${m.label}(${m.unit})</td><td>${rows[0].v[mi]}</td><td>${rows[1].v[mi]}</td></tr>`).join('');
  return `<table class="pair-table"><thead><tr><th>구분</th><th>${labels[0]}</th><th>${labels[1]}</th></tr></thead><tbody>${tr}</tbody></table>`;
}
// 인구 변화 라인 그래프 (2010=100 상댓값, 두 지역) — 수능 단골 형태
function renderPopChange(seriesA, seriesB, labels){
  labels = labels || ['(가)','(나)'];
  const W=330, H=200, L=38, R=14, T=18, B=34;
  const years=POP_SERIES_YEARS;
  const all=seriesA.concat(seriesB);
  const ymax=Math.max(200, Math.ceil(Math.max(...all)/50)*50);
  const x=i=>L+(W-L-R)*i/(years.length-1);
  const y=v=>T+(H-T-B)*(1-v/ymax);
  let grid='';
  for(let v=0; v<=ymax; v+=50){
    grid+=`<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W-R}" y2="${y(v).toFixed(1)}" stroke="#D8E8F2" stroke-width="${v===100?1.4:0.6}" ${v===100?'':'stroke-dasharray="3 3"'}/>`+
      `<text x="${L-5}" y="${(y(v)+3).toFixed(1)}" text-anchor="end" font-size="8" fill="#6E93AE">${v}</text>`;
  }
  const months=[0,3,6,9].map(i=>`<text x="${x(i).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="8" fill="#6E93AE">${("'"+String(years[i]).slice(2))}</text>`).join('');
  const line=(s,col)=>`<polyline fill="none" stroke="${col}" stroke-width="2.4" points="${s.map((v,i)=>x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ')}"/>`+
    s.map((v,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="${col}"/>`).join('');
  // 끝점 라벨
  const endLbl=(s,col,txt)=>`<text x="${(W-R-2).toFixed(1)}" y="${(y(s[s.length-1])-4).toFixed(1)}" text-anchor="end" font-size="10" font-weight="800" fill="${col}">${txt}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    ${grid}${months}
    ${line(seriesA,'#1278C2')}${line(seriesB,'#E2574C')}
    ${endLbl(seriesA,'#1278C2',labels[0])}${endLbl(seriesB,'#E2574C',labels[1])}
    <text x="${L}" y="${T-6}" font-size="8" fill="#6E93AE">2010=100 상댓값</text>
  </svg>`;
}
// 기후 그래프 2개 나란히 (수능 단골 형태)
function renderDualClimate(stA, stB, labels){
  labels = labels || ['(가)','(나)'];
  return `<div class="dual-climate">
    <div><div class="dual-label">${labels[0]}</div>${renderClimateSVG(stA)}</div>
    <div><div class="dual-label">${labels[1]}</div>${renderClimateSVG(stB)}</div>
  </div>`;
}
function renderClimateSVG(st){
  const W=340, H=210, L=38, R=44, T=14, B=24;
  const pw=W-L-R, ph=H-T-B;
  const pMax=Math.max(450, Math.ceil(Math.max(...st.p)/50)*50);
  const tLo=-30, tHi=30;
  const x=i=>L+pw*(i+0.5)/12;
  const yT=v=>T+ph*(1-(v-tLo)/(tHi-tLo));
  const yP=v=>T+ph*(1-v/pMax);
  let bars='', line='', dots='', gridT='';
  st.p.forEach((v,i)=>{ const bw=pw/12*0.62;
    bars+=`<rect x="${(x(i)-bw/2).toFixed(1)}" y="${yP(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H-B-yP(v)).toFixed(1)}" fill="#5BB8F0" opacity=".85"/>`; });
  line='<polyline fill="none" stroke="#E2574C" stroke-width="2" points="'+
    st.t.map((v,i)=>`${x(i).toFixed(1)},${yT(v).toFixed(1)}`).join(' ')+'"/>';
  st.t.forEach((v,i)=>{ dots+=`<circle cx="${x(i).toFixed(1)}" cy="${yT(v).toFixed(1)}" r="2.4" fill="#E2574C"/>`; });
  [-20,-10,0,10,20].forEach(v=>{ gridT+=`<line x1="${L}" y1="${yT(v)}" x2="${W-R}" y2="${yT(v)}" stroke="#D8E8F2" stroke-width="${v===0?1.2:0.6}"/>`+
    `<text x="${L-5}" y="${yT(v)+3}" text-anchor="end" font-size="8" fill="#6E93AE">${v}</text>`; });
  let gridP='';
  for(let v=100; v<pMax; v+=100) gridP+=`<text x="${W-R+5}" y="${(yP(v)+3).toFixed(1)}" font-size="8" fill="#6E93AE">${v}</text>`;
  const months=[1,3,5,7,9,11].map(m=>`<text x="${x(m-1).toFixed(1)}" y="${H-9}" text-anchor="middle" font-size="8" fill="#6E93AE">${m}월</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    ${gridT}${gridP}${bars}${line}${dots}${months}
    <text x="${L-5}" y="${T-3}" font-size="8" fill="#E2574C">기온(℃)</text>
    <text x="${W-R+5}" y="${T-3}" font-size="8" fill="#1278C2">강수량(mm)</text>
    <line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#A9CDE3" stroke-width="1"/>
  </svg>`;
}
// ----- 매칭형 공통 유틸 -----
const PERMS3=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const MARK_L=['A','B','C'];
function buildPermChoices(correct){
  const others=shuffle(PERMS3.filter(p=>p.join()!==correct.join())).slice(0,4);
  return shuffle([correct, ...others]);
}
function permText(perm){ return ['(가)','(나)','(다)'].map((g,i)=>`${g}-${MARK_L[perm[i]]}`).join(' · '); }
// 지도 마커 A·B·C: 좌상단 → 우상단 순서 (x 우선, 비슷하면 북쪽 먼저)
function sortMarkers(arr, xy){
  return arr.slice().sort((a,b)=>{
    const A=xy(a), B=xy(b);
    if(Math.abs(A.x-B.x)>=45) return A.x-B.x;
    return A.y-B.y;
  });
}
function fitViewTo(pts, pad){
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  let x0=Math.min(...xs)-pad, y0=Math.min(...ys)-pad;
  let w=Math.max(...xs)-Math.min(...xs)+pad*2, h=Math.max(...ys)-Math.min(...ys)+pad*2;
  const s=Math.max(w,h,220);             // 너무 과한 확대 방지
  animateView(clampedTarget({x:x0-(s-w)/2, y:y0-(s-h)/2, w:s, h:s*VIEW0.h/VIEW0.w}));
}
function addMatchMark(x, y, letter){
  const svg=$('map-svg');
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','match-mark');
  g.innerHTML=`<circle cx="${x}" cy="${y}" r="13" fill="#E2574C" stroke="#FFFFFF" stroke-width="2.5"/>`+
    `<text x="${x}" y="${y+5}" text-anchor="middle" font-size="14" font-weight="800" fill="#FFFFFF">${letter}</text>`;
  svg.appendChild(g); return g;
}
// 산점도: 두 지표 평면에 (가)~(다) 점 표시 — 수능 자료 형식
function renderScatterSVG(rows, m1, m2, labels){
  const W=320,H=230,L=52,R=16,T=18,B=40;
  const xs=rows.map(r=>r.v1), ys=rows.map(r=>r.v2);
  const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
  const px=v=>L+(W-L-R)*((v-x0)/((x1-x0)||1)*0.8+0.1);
  const py=v=>T+(H-T-B)*(1-((v-y0)/((y1-y0)||1)*0.8+0.1));
  let pts='';
  labels = labels || ['(가)','(나)','(다)'];
  rows.forEach((r,i)=>{
    pts+=`<circle cx="${px(r.v1).toFixed(1)}" cy="${py(r.v2).toFixed(1)}" r="5.5" fill="#1278C2" stroke="#fff" stroke-width="1.5"/>`+
      `<text x="${px(r.v1).toFixed(1)}" y="${(py(r.v2)-10).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#1B4F8F">${labels[i]}</text>`+
      `<text x="${px(r.v1).toFixed(1)}" y="${(py(r.v2)+18).toFixed(1)}" text-anchor="middle" font-size="9" fill="#6E93AE">${r.v1}${m1.unit==='%'||m1.unit==='℃'?m1.unit:''}, ${r.v2}${m2.unit==='%'||m2.unit==='℃'?m2.unit:''}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="climate-graph" xmlns="http://www.w3.org/2000/svg">
    <line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#A9CDE3"/>
    <line x1="${L}" y1="${T}" x2="${L}" y2="${H-B}" stroke="#A9CDE3"/>
    <text x="${(L+W-R)/2}" y="${H-12}" text-anchor="middle" font-size="10" fill="#6E93AE">${m1.label}(${m1.unit}) →</text>
    <text x="14" y="${(T+H-B)/2}" font-size="10" fill="#6E93AE" transform="rotate(-90 14 ${(T+H-B)/2})" text-anchor="middle">${m2.label}(${m2.unit}) →</text>
    ${pts}</svg>`;
}

// --- 기후 비교: 매칭형(지도 A~C ↔ 자료 가나다) / 순서형 ---
function climVal(st, key){
  const ind=climateIndicators(st);
  return key==='tavg' ? +(st.t.reduce((a,b)=>a+b,0)/12).toFixed(1) : ind[key==='tmin'?'tmin':key==='tmax'?'tmax':key];
}
function askClimate(item){
  if(item.kind==='order') return askClimateOrder(item.set);
  return askClimateMatch(item.set);
}
// ----- 2지역 비교 공통: 진술형 보기 생성 ("A는 B보다 ~") -----
function cmpWord(key, meta){
  if(key==='range'||key==='popGrow') return '크다';
  if(key==='agingIdx'||key==='tfr') return '높다';
  if(meta.unit==='℃'||meta.unit==='%') return '높다';
  return '많다';
}
function pairStatements(valsA, valsB, keys, metaOf){
  const cands=[];
  keys.forEach((k,ki)=>{
    const a=valsA[ki], b=valsB[ki];
    if(a==null||b==null) return;
    const diff=Math.abs(a-b), base=Math.max(Math.abs(a),Math.abs(b),1e-9);
    if(diff/base<0.07 && diff<0.7) return;            // 동률에 가까운 지표 제외
    const m=metaOf(k), w=cmpWord(k,m);
    cands.push({text:`A는 B보다 ${m.label}이(가) ${w}.`, truth:a>b});
    cands.push({text:`B는 A보다 ${m.label}이(가) ${w}.`, truth:b>a});
  });
  const trues=shuffle(cands.filter(c=>c.truth));
  const falses=shuffle(cands.filter(c=>!c.truth));
  if(!trues.length || falses.length<3) return null;
  return shuffle([trues[0], ...falses.slice(0,3)]);
}

function askClimateMatch(set){
  const info=MODE_INFO[G.mode];
  // 세트에서 2개 지역만 추출 (빠른 템포)
  const pick=shuffle(set.st.slice()).slice(0,2).map(n=>CLIMATE.find(c=>c.name===n));
  const markers=sortMarkers(pick, s=>({x:s.x, y:s.y}));            // A·B: 좌상단→우상단
  const gOrder=[0,1].sort((a,b)=>climVal(markers[a],set.inds[0])-climVal(markers[b],set.inds[0])); // (가)(나): 왼쪽부터
  const metas=set.inds.map(k=>CLIM_INDS[k]);
  markers.forEach((s,i)=>addMatchMark(s.x, s.y, MARK_L[i]));
  fitViewTo(markers, 95);

  const allKeys=Object.keys(CLIM_INDS);
  const stmts=pairStatements(
    allKeys.map(k=>climVal(markers[0],k)), allKeys.map(k=>climVal(markers[1],k)),
    allKeys, k=>CLIM_INDS[k]);
  const qtype = 'tap';   // 모바일 편의: 항상 지도 탭형(진술형 선지 스크롤 제거)

  // 차트 유형 다양화
  const chartLabels = qtype==='tap' ? ['(가)','(나)'] : ['A','B'];
  const chartRows = (qtype==='tap'?gOrder:[0,1]).map(mi=>({v:set.inds.map(k=>climVal(markers[mi],k))}));
  const ct=['dual','table','bars','scatter'][Math.floor(Math.random()*4)];
  let chart;
  if(ct==='dual') chart=renderDualClimate(markers[(qtype==='tap'?gOrder:[0,1])[0]], markers[(qtype==='tap'?gOrder:[0,1])[1]], chartLabels);
  else if(ct==='table') chart=renderPairTable(chartRows, metas, chartLabels);
  else if(ct==='bars') chart=renderPairBars(chartRows, metas, chartLabels);
  else chart=renderScatterSVG(chartRows.map(r=>({v1:r.v[0], v2:r.v[1]})), metas[0], metas[1], chartLabels);

  const expBody=()=>`A: ${markers[0].name} · B: ${markers[1].name}<div class="fb-extra">📌 ${set.point}</div>`;
  const revealNames=()=>{
    document.querySelectorAll('#map-svg .match-mark').forEach(g=>g.remove());
    markers.forEach(s=>{ addDot(s.x,s.y,5,'loc-dot target-reveal'); addLabel(s.x,s.y-10,s.name); });
  };

  if(qtype==='tap'){
    const target=markers[gOrder[0]];                 // (가)에 해당하는 지역
    $('question-box').innerHTML=
      `<span class="q-region">기후 비교</span> 자료의 <b style="color:var(--sea-d)">(가)</b>에 해당하는 지역을 지도의 A·B에서 탭하세요!`+
      chart+`<div class="map-hint">1991~2020년 평년값 · 위치(위도·해안/내륙·고도)로 판단!</div>`;
    $('choices-box').innerHTML='';
    const handler=(e)=>{
      if(suppressTap||G.locked) return;
      const p=svgPoint(e.clientX,e.clientY);
      const d0=Math.hypot(p.x-markers[0].x,p.y-markers[0].y), d1=Math.hypot(p.x-markers[1].x,p.y-markers[1].y);
      const tapped=d0<=d1?0:1;
      G.locked=true; clearMapTap(); stopTimer();
      const ok=markers[tapped]===target;
      revealNames();
      const pts=award(ok,90);
      pick.forEach(s=>recordStat(s.region,ok));
      feedback(ok, ok?'정답':`오답 (탭: ${MARK_L[tapped]})`, `(가)는 <b>${MARK_L[markers.indexOf(target)]} ${target.name}</b> · `+expBody(), pts);
      hudUpdate(); afterAnswer();
    };
    setMapTap(handler);
    startTimer(28,()=>{ if(G.locked)return; G.locked=true; clearMapTap();
      revealNames(); award(false,0); pick.forEach(s=>recordStat(s.region,false));
      feedback(false,'시간 초과',`(가)는 <b>${target.name}</b> · `+expBody(),0);
      hudUpdate(); afterAnswer();
    });
  } else {
    $('question-box').innerHTML=
      `<span class="q-region">기후 비교</span> 지도에 표시된 A, B 두 지역에 대한 설명으로 <b style="color:var(--sea-d)">옳은 것</b>은?`+
      chart+`<div class="map-hint">자료와 위치를 함께 보고 판단하세요</div>`;
    const box=$('choices-box'); box.innerHTML='';
    stmts.forEach(st=>{
      const b=document.createElement('button');
      b.className='choice-btn'; b.textContent=st.text; b.dataset.t=st.truth?'1':'0';
      b.onclick=()=>{
        if(G.locked) return; G.locked=true; stopTimer();
        box.querySelectorAll('button').forEach(x=>x.disabled=true);
        const ok=st.truth;
        b.classList.add(ok?'correct':'wrong');
        if(!ok) box.querySelectorAll('button').forEach(x=>{ if(x.dataset.t==='1') x.classList.add('correct'); });
        revealNames();
        const pts=award(ok,120);
        pick.forEach(s=>recordStat(s.region,ok));
        feedback(ok,ok?'정답':'오답',expBody(),pts);
        hudUpdate(); afterAnswer();
      };
      box.appendChild(b);
    });
    startTimer(info.time||30,()=>{ if(G.locked)return; G.locked=true;
      box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.t==='1') x.classList.add('correct'); });
      revealNames(); award(false,0); pick.forEach(s=>recordStat(s.region,false));
      feedback(false,'시간 초과',expBody(),0);
      hudUpdate(); afterAnswer();
    });
  }
}
function askClimateOrder(set){
  const sts=set.st.map(n=>CLIMATE.find(c=>c.name===n));
  const m=CLIM_INDS[set.ind];
  const sorted=sts.slice().sort((a,b)=>climVal(b,set.ind)-climVal(a,set.ind));
  const correct=sorted.map(s=>s.name).join(' > ');
  $('question-box').innerHTML=
    `<span class="q-region">기후 비교</span> 다음 세 지역을 <b style="color:var(--accent-l)">${m.label}</b>이(가) 큰 지역부터 순서대로 옳게 나열한 것은?`+
    `<div class="stat-card" style="text-align:center;font-weight:700">${shuffle(sts.slice()).map(s=>s.name).join(' · ')}</div>`+
    `<div class="map-hint">위치(위도·내륙/해안·고도)를 떠올리며 상대 비교 — 절댓값 암기가 아닌 원리로!</div>`;
  let perms=shuffle(PERMS3).slice(0,5);
  if(!perms.some(p=>p.map(i=>sts[i].name).join(' > ')===correct)){
    perms[0]=sorted.map(s=>sts.indexOf(s)); perms=shuffle(perms);   // 정답 보장 후 재섞기
  }
  const expBody=`${sorted.map(s=>`${s.name} ${climVal(s,set.ind)}${m.unit}`).join(' > ')}<div class="fb-extra">📌 ${set.point}</div>`;
  const box=$('choices-box'); box.innerHTML='';
  perms.forEach(p=>{
    const txt=p.map(i=>sts[i].name).join(' > ');
    const b=document.createElement('button');
    b.className='choice-btn'; b.textContent=txt; b.dataset.t=txt;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      box.querySelectorAll('button').forEach(x=>x.disabled=true);
      const ok=txt===correct;
      b.classList.add(ok?'correct':'wrong');
      if(!ok) box.querySelectorAll('button').forEach(x=>{ if(x.dataset.t===correct) x.classList.add('correct'); });
      const pts=award(ok,110);
      sts.forEach(s=>recordStat(s.region,ok));
      feedback(ok,ok?'정답':'오답',expBody,pts);
      hudUpdate(); afterAnswer();
    };
    box.appendChild(b);
  });
  startTimer(MODE_INFO[G.mode].time||25,()=>{ if(G.locked)return; G.locked=true;
    box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.t===correct) x.classList.add('correct'); });
    award(false,0); sts.forEach(s=>recordStat(s.region,false));
    feedback(false,'시간 초과',expBody,0);
    hudUpdate(); afterAnswer();
  });
}

// --- 통계 비교: 지도에 표시된 세 시·도 A~C ↔ 통계 자료 (가)~(다) 매칭 ---
let PROV_CENTER=null;
function provCenter(name){
  if(!PROV_CENTER){
    PROV_CENTER={};
    const acc={};
    for(const [n,m] of Object.entries(MUNIS)){
      (acc[m.prov]=acc[m.prov]||[]).push([m.cx,m.cy]);
    }
    for(const [p,pts] of Object.entries(acc)){
      PROV_CENTER[p]={x:pts.reduce((a,b)=>a+b[0],0)/pts.length, y:pts.reduce((a,b)=>a+b[1],0)/pts.length};
    }
  }
  return PROV_CENTER[name];
}
function statVal(sd, key){
  if(key==='popGrow') return sd.pop1970 ? +(sd.pop2020/sd.pop1970).toFixed(1) : null;
  const m=STAT_INDS[key];
  return +(sd[key]*m.scale).toFixed(sd[key]*m.scale>=100?0:1);
}
function shortSido(n){ return n.replace(/(특별자치시|특별자치도|광역시|특별시)$/,''); }
function askStats(set){
  const info=MODE_INFO[G.mode];
  const pick=shuffle(set.sd.slice()).slice(0,2).map(n=>SIDO_STATS.find(s=>s.name===n));
  const markers=sortMarkers(pick, s=>provCenter(s.name));          // A·B: 좌상단→우상단
  const gOrder=[0,1].sort((a,b)=>statVal(markers[a],set.inds[0])-statVal(markers[b],set.inds[0]));
  const metas=set.inds.map(k=>STAT_INDS[k]);

  const target=new Set(markers.map(s=>s.name));
  document.querySelectorAll('#map-svg .muni').forEach(x=>{ if(!target.has(x.dataset.prov)) x.classList.add('dim-region'); });
  markers.forEach((s,i)=>{ const c=provCenter(s.name); addMatchMark(c.x, c.y, MARK_L[i]); });

  const allKeys=Object.keys(STAT_INDS);
  const stmts=pairStatements(
    allKeys.map(k=>statVal(markers[0],k)), allKeys.map(k=>statVal(markers[1],k)),
    allKeys, k=>STAT_INDS[k]);
  const qtype = 'tap';   // 모바일 편의: 항상 지도 탭형(진술형 선지 스크롤 제거)

  // 인구 변화 그래프 사용 조건: 탭형 + 둘 다 시계열 보유 + 2020 상댓값 차이가 충분
  const canPop = markers.every(s=>s.popSeries) && Math.abs(markers[0].popSeries[9]-markers[1].popSeries[9])>=12;
  const usePop = qtype==='tap' && canPop && Math.random()<0.5;
  // 인구 변화일 땐 (가)(나)를 2020 상댓값 오름차순으로 매핑(그래프 끝점 낮은 쪽=가)
  const order = usePop ? [0,1].sort((a,b)=>markers[a].popSeries[9]-markers[b].popSeries[9]) : (qtype==='tap'?gOrder:[0,1]);
  const chartLabels = qtype==='tap' ? ['(가)','(나)'] : ['A','B'];
  let chart;
  if(usePop){
    chart=renderPopChange(markers[order[0]].popSeries, markers[order[1]].popSeries, chartLabels);
  } else {
    const chartRows = order.map(mi=>({v:set.inds.map(k=>statVal(markers[mi],k))}));
    const ct=['table','bars','scatter'][Math.floor(Math.random()*3)];
    if(ct==='table') chart=renderPairTable(chartRows, metas, chartLabels);
    else if(ct==='bars') chart=renderPairBars(chartRows, metas, chartLabels);
    else chart=renderScatterSVG(chartRows.map(r=>({v1:r.v[0], v2:r.v[1]})), metas[0], metas[1], chartLabels);
  }

  const popPoint = usePop
    ? `<div class="fb-extra">📈 1975~2020 인구 변화(2010=100): 수도권·대도시 주변은 우상향, 농어촌·산업 쇠퇴 지역은 우하향</div>` : '';
  const expBody=()=>`A: ${shortSido(markers[0].name)} · B: ${shortSido(markers[1].name)}<div class="fb-extra">📌 ${set.point}</div>${popPoint}`;
  const revealNames=()=>{
    document.querySelectorAll('#map-svg .match-mark').forEach(g=>g.remove());
    markers.forEach(s=>{ const c=provCenter(s.name); addLabel(c.x, c.y+4, shortSido(s.name)); });
  };

  if(qtype==='tap'){
    const targetSd=markers[order[0]];
    $('question-box').innerHTML=
      `<span class="q-region">통계 비교</span> 자료의 <b style="color:var(--sea-d)">(가)</b>에 해당하는 시·도를 지도의 A·B에서 탭하세요!`+
      chart+`<div class="map-hint">${usePop?'인구 변화 그래프(2010=100) — 증가/감소 추세로 판단!':'통계청 자료 — 산업·인구의 지역 차로 판단!'} (A·B 시·도만 탭 가능)</div>`;
    $('choices-box').innerHTML='';
    const handler=(e)=>{
      if(suppressTap||G.locked) return;
      const t=e.target.closest('.muni');
      if(!t || !target.has(t.dataset.prov)) return;      // A·B 외 탭은 무시
      G.locked=true; clearMapTap(); stopTimer();
      const ok=t.dataset.prov===targetSd.name;
      revealNames();
      const pts=award(ok,90);
      pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,ok));
      feedback(ok, ok?'정답':`오답 (탭: ${shortSido(t.dataset.prov)})`, `(가)는 <b>${shortSido(targetSd.name)}</b> · `+expBody(), pts);
      hudUpdate(); afterAnswer();
    };
    setMapTap(handler);
    startTimer(28,()=>{ if(G.locked)return; G.locked=true; clearMapTap();
      revealNames(); award(false,0); pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,false));
      feedback(false,'시간 초과',`(가)는 <b>${shortSido(targetSd.name)}</b> · `+expBody(),0);
      hudUpdate(); afterAnswer();
    });
  } else {
    $('question-box').innerHTML=
      `<span class="q-region">통계 비교</span> 지도에 표시된 A, B 두 시·도에 대한 설명으로 <b style="color:var(--sea-d)">옳은 것</b>은?`+
      chart+`<div class="map-hint">자료와 위치를 함께 보고 판단하세요</div>`;
    const box=$('choices-box'); box.innerHTML='';
    stmts.forEach(st=>{
      const b=document.createElement('button');
      b.className='choice-btn'; b.textContent=st.text; b.dataset.t=st.truth?'1':'0';
      b.onclick=()=>{
        if(G.locked) return; G.locked=true; stopTimer();
        box.querySelectorAll('button').forEach(x=>x.disabled=true);
        const ok=st.truth;
        b.classList.add(ok?'correct':'wrong');
        if(!ok) box.querySelectorAll('button').forEach(x=>{ if(x.dataset.t==='1') x.classList.add('correct'); });
        revealNames();
        const pts=award(ok,120);
        pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,ok));
        feedback(ok,ok?'정답':'오답',expBody(),pts);
        hudUpdate(); afterAnswer();
      };
      box.appendChild(b);
    });
    startTimer(info.time||30,()=>{ if(G.locked)return; G.locked=true;
      box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.t==='1') x.classList.add('correct'); });
      revealNames(); award(false,0); pick.forEach(s=>recordStat(PROVINCES[s.name]?.region,false));
      feedback(false,'시간 초과',expBody(),0);
      hudUpdate(); afterAnswer();
    });
  }
}

// --- 4지선다 ---
function askMCQ(q){
  const info=MODE_INFO[G.mode];
  $('question-box').innerHTML=`<span class="q-region">${q.region}</span> ${q.q}`;
  const box=$('choices-box'); box.innerHTML='';
  const order=shuffle(q.choices.map((c,i)=>i));
  order.forEach(i=>{
    const b=document.createElement('button');
    b.className='choice-btn'; b.innerHTML=q.choices[i];
    b.dataset.i=i;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      box.querySelectorAll('button').forEach(x=>x.disabled=true);
      const correct=i===q.answer;
      b.classList.add(correct?'correct':'wrong');
      if(!correct){ box.querySelectorAll('button').forEach(x=>{ if(x.dataset.i==q.answer) x.classList.add('correct'); }); }
      const pts=award(correct,100);
      recordStat(q.region,correct);
      feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`💡 ${q.exp}`,pts);
      hudUpdate(); afterAnswer();
    };
    box.appendChild(b);
  });
  startTimer(info.time||25,()=>{ if(G.locked)return; G.locked=true;
    box.querySelectorAll('button').forEach(x=>{ x.disabled=true; if(x.dataset.i==q.answer) x.classList.add('correct'); });
    award(false,0); recordStat(q.region,false);
    feedback(false,'⏰ 아깝다, 시간 초과!',`💡 ${q.exp}`,0);
    hudUpdate(); afterAnswer();
  });
}

// --- OX ---
function askOX(q){
  $('question-box').innerHTML=`<span class="q-region">${q.region}</span> ${q.q}`;
  const box=$('choices-box');
  box.innerHTML='<div class="ox-row"></div>';
  const row=box.firstChild;
  [['⭕',true],['❌',false]].forEach(([label,val])=>{
    const b=document.createElement('button');
    b.className='choice-btn'; b.textContent=label;
    b.onclick=()=>{
      if(G.locked) return; G.locked=true; stopTimer();
      row.querySelectorAll('button').forEach(x=>x.disabled=true);
      const correct=val===q.answer;
      b.classList.add(correct?'correct':'wrong');
      const pts=award(correct,70);
      recordStat(q.region,correct);
      feedback(correct,correct?'⭕ 정답!':'❌ 오답!',`정답: ${q.answer?'O':'X'} — ${q.exp}`,pts);
      hudUpdate(); afterAnswer();
    };
    row.appendChild(b);
  });
  const sec = G.mode==='ox' ? Math.min(8,(G.oxEnd-Date.now())/1000) : 9;
  startTimer(Math.max(1,sec),()=>{ if(G.locked)return; G.locked=true;
    row.querySelectorAll('button').forEach(x=>x.disabled=true);
    award(false,0); recordStat(q.region,false);
    if(G.mode==='ox' && Date.now()>=G.oxEnd) return endGame();
    feedback(false,'⏰ 아깝다, 시간 초과!',`정답: ${q.answer?'O':'X'} — ${q.exp}`,0);
    hudUpdate(); afterAnswer();
  });
}

// ============================================================
// 탐색(학습) 모드 — 탭 기반
// ============================================================
const EXP={list:[], i:-1};
function startExplore(){
  show('screen-game');
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='hidden');
  $('timer-bar').style.width='0%';

  $('question-box').innerHTML='<span class="q-region">학습 모드</span> 지도에서 시·군을 탭하거나, ◀ ▶ 로 지역을 넘겨 보세요.';
  const box=$('choices-box');
  box.innerHTML='<div class="explore-controls" id="exp-chips"></div><div id="exp-info" class="exp-info">지역을 선택하면 핵심 정보가 여기에 표시됩니다.</div>';
  const chipBox=$('exp-chips');
  ['전체',...MAP_REGIONS].forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(r==='전체'?' on':''); b.textContent=regionLabel(r);
    b.onclick=()=>{ chipBox.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); b.classList.add('on'); renderExploreDots(r); };
    chipBox.appendChild(b);
  });
  renderExploreDots('전체');

  // 시·군/점 탭 → 해당 지역으로 이동
  const svg=$('map-svg');
  svg.onclick=(e)=>{
    if(suppressTap) return;
    const dot=e.target.closest('.loc-dot');
    if(dot){ const i=EXP.list.findIndex(l=>l.name===dot.dataset.name); if(i>=0) expShow(i); return; }
    const t=e.target.closest('.muni');
    if(!t) return;
    const name=t.dataset.name;
    const i=EXP.list.findIndex(l=>l.accept.includes(name));
    if(i>=0){ expShow(i); return; }
    // 등록 지점이 없는 시·군: 간단 정보 + 확대
    document.querySelectorAll('#map-svg .muni').forEach(x=>x.classList.remove('flash'));
    t.classList.add('flash');
    const bb=muniBBox(name);
    fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}], Math.max(bb.w,bb.h)*0.8+40);
    const rc2=REGION_COLORS[MUNIS[name].region]||{};
    $('exp-info').innerHTML=
      `<div class="exp-head"><b>${name.replace(/\(.+\)$/,'')}</b><span class="reg-chip" style="background:${rc2.deep||'var(--sea)'}">${regionLabel(MUNIS[name].region)}</span></div>`+
      `<div class="exp-popline">${popBadgeHTML(name)}</div>`+
      `<div class="exp-text">등록된 수능 포인트가 없는 지역 — 경계와 위치만 눈에 익혀 두세요!</div>`+studyExtra(name.replace(/\(.+\)$/,''));
  };
}
// 괄호 내부와 숫자(33.9km, 1,947m 등)를 보호하며 쉼표·마침표로 분리
function splitFact(f){
  const parts=[]; let cur=''; let depth=0;
  for(let i=0;i<(f||'').length;i++){
    const ch=f[i];
    if(ch==='('||ch==='（') depth++;
    if(ch===')'||ch==='）') depth=Math.max(0,depth-1);
    const numCtx=/\d/.test(f[i-1]||'') && /\d/.test(f[i+1]||'');
    if((ch===','||ch==='.') && depth===0 && !numCtx){ parts.push(cur); cur=''; }
    else cur+=ch;
  }
  parts.push(cur);
  return parts.map(s=>s.trim()).filter(s=>s.length>=2);
}
// 뱃지는 핵심 8종만: 도명 유래·특례시·도청 소재지·혁신도시·기업도시·1기/2기 신도시·국가 산업 단지
const DONAME_ORIGIN=['강릉','원주','충주','청주','전주','나주','경주','상주'];   // 강원·충청·전라·경상
const TEUKRYE=['수원','고양','용인','창원','화성'];                              // 특례시(2022·2025)
const SINDOSI1=['성남','고양','부천'];                                           // 분당·일산·중동 (안양·군포는 지점 미등록)
const SINDOSI2=['성남','화성','김포','파주','수원','용인','하남','평택','인천']; // 판교·동탄·한강·운정·광교·위례·고덕·검단
// 유네스코 세계유산 보유 시·군 (heritage 매칭세트 기준)
const UNESCO_CITY=['경주','합천','서울','수원','안동','공주','부여','익산','고창','양산','영주','보은','순천','김제','남양주','구리','고양','화성','여주','강화'];
function hasUnesco(loc){ return UNESCO_CITY.includes((loc.name||'').replace(/\(.+\)$/,'')); }
function factBadges(loc){
  const fact=loc.fact||'';
  const base=(loc.name||'').replace(/\(.+\)$/,'');
  const badges=[];
  const add=(t,cls)=>{ if(!badges.some(b=>b.t===t)) badges.push({t,cls}); };
  if(DONAME_ORIGIN.includes(base)) add('📜 도명 유래','b-origin');
  if(TEUKRYE.includes(base)||/특례시/.test(fact)) add('⭐ 특례시','b-teuk');
  if(/도청/.test(fact)) add('🏛️ 도청 소재지','b-docheong');
  if(hasUnesco(loc)) add('🏯 유네스코','b-unesco');
  if(/혁신도시/.test(fact)) add('🏢 혁신도시','b-hyuksin');
  if(/기업도시/.test(fact)) add('💼 기업도시','b-gieop');
  if(SINDOSI1.includes(base)||/1기 신도시/.test(fact)) add('🏘️ 1기 신도시','b-sin1');
  if(SINDOSI2.includes(base)||/2기 신도시/.test(fact)) add('🌆 2기 신도시','b-sin2');
  if(/국가 ?산업 ?단지/.test(fact)) add('⚙️ 국가산단','b-sandan');
  return {badges, texts:splitFact(fact)};
}
// 권역 표기: 수도권 외에는 '권'을 붙여 통일 (강원권·충청권…)
function regionLabel(r){
  return (r==='수도권'||!MAP_REGIONS.includes(r)) ? r : r+'권';
}
// 시·군 인구 순위 (전국 / 권역 내)
let POP_RANK=null;
function popRank(name){
  if(!POP_RANK){
    POP_RANK={};
    const entries=Object.entries(MUNIS).filter(([n,m])=>m.pop>0);
    const nat=entries.slice().sort((a,b)=>b[1].pop-a[1].pop);
    nat.forEach(([n],i)=>POP_RANK[n]={nat:i+1});
    for(const reg of MAP_REGIONS){
      entries.filter(([n,m])=>m.region===reg)
        .sort((a,b)=>b[1].pop-a[1].pop)
        .forEach(([n],i)=>{ POP_RANK[n].reg=i+1; });
    }
  }
  return POP_RANK[name];
}
function popBadgeHTML(muniName, region){
  const m=MUNIS[muniName];
  if(!m||!m.pop) return '';
  const r=popRank(muniName);
  return `<span class="exp-pop">👥 인구 ${fmtPop(m.pop)}</span>`+
    `<span class="exp-rank rk-nat">전국 ${r.nat}위</span>`+
    `<span class="exp-rank rk-reg">${regionLabel(region||m.region)} ${r.reg}위</span>`;
}
function expShow(i){
  if(!EXP.list.length || !$('exp-info')) return;   // 탐색 화면이 아니면 안전 종료
  EXP.i=(i+EXP.list.length)%EXP.list.length;
  const l=EXP.list[EXP.i];
  // 지도: 해당 시·군 강조 + 확대
  document.querySelectorAll('#map-svg .muni').forEach(x=>x.classList.remove('flash'));
  l.accept.forEach(n=>muniEl(n)?.classList.add('flash'));
  const bb=muniBBox(l.accept[0]);
  fitViewTo([{x:bb.x,y:bb.y},{x:bb.x+bb.w,y:bb.y+bb.h}], Math.max(bb.w,bb.h)*0.8+40);
  // 정보 패널
  const {badges,texts}=factBadges(l);
  const rc=REGION_COLORS[l.region]||{};
  $('exp-info').innerHTML=
    `<div class="exp-nav">
       <button class="ghost-btn exp-prev">◀ 이전</button>
       <span class="exp-count">${EXP.i+1} / ${EXP.list.length}</span>
       <button class="ghost-btn exp-next">다음 ▶</button>
     </div>
     <div class="exp-head"><b>${cardDisplayName(l)}</b>
       <span class="reg-chip" style="background:${rc.deep||'var(--sea)'}">${regionLabel(l.region)}</span>
     </div>
     <div class="exp-popline">${popBadgeHTML(l.accept[0], l.region)}</div>`+
    (badges.length?`<div class="exp-badges">${badges.map(b=>`<span class="exp-badge ${b.cls}">${b.t}</span>`).join('')}</div>`:'')+
    (texts.length?`<div class="exp-text">${texts.join('. ')}</div>`:'')+
    studyExtra(l.name.replace(/\(.+\)$/,''));
  $('exp-info').querySelector('.exp-prev').onclick=()=>expShow(EXP.i-1);
  $('exp-info').querySelector('.exp-next').onclick=()=>expShow(EXP.i+1);
  // 좌우 스와이프로도 넘기기
  const panel=$('exp-info');
  let sx=null;
  panel.ontouchstart=(e)=>{ sx=e.touches[0].clientX; };
  panel.ontouchend=(e)=>{
    if(sx===null) return;
    const dx=e.changedTouches[0].clientX-sx; sx=null;
    if(Math.abs(dx)>48) expShow(EXP.i+(dx<0?1:-1));
  };
}
function renderExploreDots(region){
  clearMapExtras();
  resetView();
  dimOtherRegions(region==='전체'?'전체':region);
  EXP.list=LOCATIONS.filter(l=>region==='전체'||l.region===region);
  EXP.i=-1;
  $('exp-info').innerHTML='지역을 선택하거나 ◀ ▶ 로 넘겨 보세요.'+
    `<div class="exp-nav" style="margin-top:8px"><button class="ghost-btn" id="exp-first">첫 지역부터 보기 ▶</button></div>`;
  $('exp-info').querySelector('#exp-first').onclick=()=>expShow(0);
  // 지도 위 빨간 지점 점은 표시하지 않음(시·군 폴리곤을 직접 탭해 학습) — 어수선함 제거
}
function positionTip(e,tip){
  const rect=$('map-pane').getBoundingClientRect();
  tip.style.left=Math.max(4, Math.min(rect.width-270, e.clientX-rect.left+14))+'px';
  tip.style.top=(e.clientY-rect.top+10)+'px';
}

// ============================================================
// 📖 지역 카드 컬렉션 (뽑기/수집)
// ============================================================
let coins = num(store.load('geo_coins', 0));
let cards = store.load('geo_cards', {});          // {지역명: 보유 수}
const DRAW_COST = 5;

// (등급 시스템 제거) — 모든 지역 균등 뽑기, 카드 외형은 강화 단계로만 구분
// ⚡ 카드 강화 — 다 모은 뒤에도 카드를 키우는 코인 소비 시스템(공정성 위해 게임 능력엔 영향 없음)
let cardLv = store.load('geo_cardlv', {});          // {지역명: 강화 레벨 1~5}
const CARD_MAX_LV = 3;           // 1 최초 획득 · 2 강화 · 3 최종(MAX)
const ENHANCE_NEED = 5;          // 같은 카드 5장을 합쳐 강화(4장 소모, 1장이 강화됨)
function cardLevel(name){ return cardLv[name] || 1; }
function enhanceScore(){ return Object.keys(cards).reduce((s,n)=>s+(cardLevel(n)-1),0); }   // 도감 총 강화도
function canEnhance(name){ return !!cards[name] && cardLevel(name)<CARD_MAX_LV && cards[name]>=ENHANCE_NEED; }
function doEnhance(name){
  if(!canEnhance(name)) return false;
  cards[name]-=(ENHANCE_NEED-1);                // 5장 → 강화된 1장(4장 소모)
  cardLv[name]=cardLevel(name)+1;
  store.save('geo_cards',cards); store.save('geo_cardlv',cardLv);
  updateGachaUI(); checkAchievements(); scheduleSync();
  return true;
}
function starHTML(lv){ let s=''; for(let i=1;i<=CARD_MAX_LV;i++) s+=`<span class="cstar${i<=lv?' on':''}">★</span>`; return s; }
function cardEmoji(loc){
  const f=(loc.fact||'')+(loc.name||'');
  const rules=[[/공항/,'✈️'],[/조선|항만|항구/,'🚢'],[/제철|철강/,'🏭'],[/석유 화학|정유/,'🛢️'],
    [/반도체|전자|디스플레이|IT/,'💻'],[/자동차/,'🚗'],[/한우|목축|축산/,'🐂'],[/녹차|차밭|다향/,'🍵'],
    [/사과/,'🍎'],[/포도|와인/,'🍇'],[/감귤/,'🍊'],[/인삼|홍삼/,'🌿'],[/쌀|평야|곡창|벼/,'🌾'],
    [/갯벌|염전|천일염/,'🦀'],[/화산|오름|용암|주상 절리/,'🌋'],[/석회|카르스트|동굴/,'🕳️'],
    [/눈|동계|스키|산천어/,'❄️'],[/온천/,'♨️'],[/신도시|택지/,'🏙️'],[/도청|행정|청사/,'🏛️'],
    [/세계 .?유산|불국사|해인사|하회|법주사|고인돌|왕릉|청자/,'🏯'],[/축제/,'🎉'],
    [/기차|철도|KTX/,'🚄'],[/섬|도서|다도해/,'🏝️'],[/호수|호반|댐/,'💧'],[/국립 공원|산/,'⛰️'],
    [/치즈/,'🧀'],[/나비|반딧불|생태|습지|늪/,'🦋'],[/마늘|양파/,'🧄'],[/구석기|유적/,'🗿'],
    [/원자력|발전/,'⚡'],[/우주|항공/,'🚀'],[/혁신도시/,'🏢']];
  for(const [re,e] of rules) if(re.test(f)) return e;
  return '📍';
}
let MUNI_BBOX={};
function muniBBox(name){
  if(MUNI_BBOX[name]) return MUNI_BBOX[name];
  const d=MUNIS[name].d;
  const nums=d.match(/-?\d+\.?\d*/g).map(Number);
  let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  for(let i=0;i<nums.length;i+=2){
    if(nums[i]<minx)minx=nums[i]; if(nums[i]>maxx)maxx=nums[i];
    if(nums[i+1]<miny)miny=nums[i+1]; if(nums[i+1]>maxy)maxy=nums[i+1];
  }
  const pad=Math.max(maxx-minx,maxy-miny)*0.1;
  return MUNI_BBOX[name]={x:minx-pad,y:miny-pad,w:maxx-minx+pad*2,h:maxy-miny+pad*2};
}
// 권역별 카드 색 (배경 틴트 / 칩·지도 채움색)
const REGION_COLORS = {
  '수도권': {bg:'#D9EFFD', deep:'#1278C2', map:'#6FB7EC'},
  '강원':   {bg:'#DDF3E1', deep:'#2FA34F', map:'#7FCB8F'},
  '충청':   {bg:'#FFF3C9', deep:'#C77F00', map:'#F6CE5B'},
  '호남':   {bg:'#FFE5E1', deep:'#D8554A', map:'#F08A80'},
  '영남':   {bg:'#EAE4FB', deep:'#6A5ACD', map:'#A795E0'},
  '제주':   {bg:'#FFE9D4', deep:'#E8740C', map:'#F9A86B'},
};
// ----- 지역성 테마 스탬프(미니 일러스트) 라이브러리 -----
// 각 스탬프는 100×100 기준 좌표로 그리고 호출 시 위치·크기로 변환
const STAMP_ART = {
  tea:    `<ellipse cx="35" cy="55" rx="26" ry="14" fill="#2FA34F" transform="rotate(-35 35 55)"/><ellipse cx="68" cy="48" rx="24" ry="13" fill="#5CB531" transform="rotate(25 68 48)"/><path d="M35 55 Q50 30 68 48" stroke="#1F7A38" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  ship:   `<path d="M15 62 L85 62 L72 84 L28 84 Z" fill="#1278C2"/><rect x="44" y="34" width="12" height="28" fill="#E2574C"/><rect x="36" y="46" width="28" height="16" rx="3" fill="#fff"/><path d="M8 70 Q18 64 28 70 T48 70 T68 70 T88 70" stroke="#7CC4F0" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  factory:`<rect x="20" y="45" width="60" height="38" rx="4" fill="#8FA6B6"/><rect x="28" y="28" width="12" height="20" fill="#6E93AE"/><rect x="52" y="22" width="12" height="26" fill="#6E93AE"/><circle cx="34" cy="18" r="8" fill="#fff" opacity=".9"/><circle cx="62" cy="12" r="10" fill="#fff" opacity=".8"/><rect x="30" y="56" width="11" height="11" fill="#FFD23F"/><rect x="56" y="56" width="11" height="11" fill="#FFD23F"/>`,
  apple:  `<circle cx="50" cy="58" r="26" fill="#E2574C"/><circle cx="40" cy="50" r="8" fill="#FF8E8E" opacity=".8"/><path d="M50 34 Q52 22 62 18" stroke="#7A4E21" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="66" cy="26" rx="12" ry="7" fill="#5CB531" transform="rotate(28 66 26)"/>`,
  grape:  `<circle cx="38" cy="46" r="11" fill="#8E7BE5"/><circle cx="60" cy="46" r="11" fill="#7E6CD9"/><circle cx="49" cy="60" r="11" fill="#6A5ACD"/><circle cx="38" cy="73" r="10" fill="#8E7BE5"/><circle cx="60" cy="73" r="10" fill="#7E6CD9"/><path d="M50 36 Q50 22 58 16" stroke="#7A4E21" stroke-width="5" fill="none" stroke-linecap="round"/><ellipse cx="64" cy="22" rx="11" ry="6" fill="#5CB531" transform="rotate(20 64 22)"/>`,
  citrus: `<circle cx="50" cy="58" r="26" fill="#FF9F2E"/><circle cx="41" cy="50" r="7" fill="#FFC97C" opacity=".9"/><ellipse cx="58" cy="30" rx="12" ry="7" fill="#2FA34F" transform="rotate(-18 58 30)"/>`,
  rice:   `<path d="M50 84 Q48 52 50 30" stroke="#C7A14A" stroke-width="5" fill="none"/><g fill="#FFD23F" stroke="#C7A14A" stroke-width="2"><ellipse cx="42" cy="34" rx="7" ry="11" transform="rotate(20 42 34)"/><ellipse cx="58" cy="34" rx="7" ry="11" transform="rotate(-20 58 34)"/><ellipse cx="40" cy="50" rx="7" ry="11" transform="rotate(25 40 50)"/><ellipse cx="60" cy="50" rx="7" ry="11" transform="rotate(-25 60 50)"/><ellipse cx="50" cy="22" rx="7" ry="11"/></g>`,
  crab:   `<ellipse cx="50" cy="58" rx="24" ry="17" fill="#F08A80"/><circle cx="42" cy="50" r="4.5" fill="#fff"/><circle cx="58" cy="50" r="4.5" fill="#fff"/><circle cx="42" cy="50" r="2.2" fill="#4A3426"/><circle cx="58" cy="50" r="2.2" fill="#4A3426"/><path d="M28 46 Q14 36 18 24 M72 46 Q86 36 82 24" stroke="#E2574C" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="16" cy="22" r="7" fill="#E2574C"/><circle cx="84" cy="22" r="7" fill="#E2574C"/>`,
  snow:   `<g stroke="#7CC4F0" stroke-width="6" stroke-linecap="round"><path d="M50 18 V82 M22 34 L78 66 M78 34 L22 66"/></g><circle cx="50" cy="50" r="8" fill="#fff" stroke="#7CC4F0" stroke-width="4"/>`,
  mountain:`<path d="M14 80 L42 32 L60 60 L72 42 L90 80 Z" fill="#2FA34F"/><path d="M42 32 L52 49 L46 49 L54 60 L34 60 L42 46 Z" fill="#fff" opacity=".9"/>`,
  temple: `<path d="M18 46 Q50 18 82 46 L74 46 Q50 28 26 46 Z" fill="#4A6E3A"/><path d="M24 50 H76 L72 44 H28 Z" fill="#8E5A2B"/><rect x="32" y="50" width="36" height="26" fill="#F2E6D0"/><rect x="44" y="56" width="12" height="20" fill="#8E5A2B"/><rect x="28" y="76" width="44" height="7" rx="2" fill="#A8794A"/>`,
  train:  `<rect x="22" y="34" width="56" height="38" rx="14" fill="#fff" stroke="#1278C2" stroke-width="5"/><rect x="30" y="42" width="40" height="13" rx="5" fill="#7CC4F0"/><circle cx="38" cy="64" r="5" fill="#1B4F8F"/><circle cx="62" cy="64" r="5" fill="#1B4F8F"/><path d="M22 78 H78" stroke="#9CC8E8" stroke-width="5" stroke-linecap="round"/>`,
  lighthouse:`<path d="M42 30 H58 L62 78 H38 Z" fill="#fff" stroke="#E2574C" stroke-width="4"/><path d="M40 44 H60 M39 58 H61" stroke="#E2574C" stroke-width="7"/><rect x="40" y="18" width="20" height="13" rx="4" fill="#FFD23F"/><path d="M30 84 H70" stroke="#1278C2" stroke-width="6" stroke-linecap="round"/>`,
  ginseng:`<path d="M50 30 Q46 48 50 56 Q40 62 36 78 M50 56 Q60 64 62 80 M50 42 Q42 46 38 42" stroke="#D9B48A" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M50 30 Q44 18 34 16 M50 30 Q56 16 66 14" stroke="#2FA34F" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="14" rx="9" ry="5" fill="#5CB531"/><ellipse cx="68" cy="12" rx="9" ry="5" fill="#5CB531"/>`,
  cheese: `<path d="M16 64 L84 40 L84 76 L16 76 Z" fill="#FFD23F" stroke="#E8B100" stroke-width="3"/><circle cx="42" cy="62" r="6" fill="#FFF3C9"/><circle cx="62" cy="56" r="5" fill="#FFF3C9"/><circle cx="70" cy="68" r="4" fill="#FFF3C9"/>`,
  butterfly:`<g fill="#F2889B"><ellipse cx="34" cy="42" rx="17" ry="14" transform="rotate(-20 34 42)"/><ellipse cx="66" cy="42" rx="17" ry="14" transform="rotate(20 66 42)"/><ellipse cx="36" cy="64" rx="13" ry="11" transform="rotate(15 36 64)" fill="#FF6B9D"/><ellipse cx="64" cy="64" rx="13" ry="11" transform="rotate(-15 64 64)" fill="#FF6B9D"/></g><rect x="46" y="34" width="8" height="40" rx="4" fill="#4A3426"/><path d="M48 32 Q42 22 36 20 M52 32 Q58 22 64 20" stroke="#4A3426" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
  hotspring:`<ellipse cx="50" cy="68" rx="30" ry="14" fill="#7CC4F0"/><path d="M36 50 Q32 40 36 32 M50 52 Q46 40 50 30 M64 50 Q60 40 64 32" stroke="#9CC8E8" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  cow:    `<ellipse cx="50" cy="56" rx="26" ry="22" fill="#C68A4F"/><ellipse cx="50" cy="66" rx="13" ry="9" fill="#F2D9BD"/><circle cx="41" cy="48" r="4" fill="#4A3426"/><circle cx="59" cy="48" r="4" fill="#4A3426"/><circle cx="45" cy="65" r="2.5" fill="#8E5A2B"/><circle cx="55" cy="65" r="2.5" fill="#8E5A2B"/><path d="M26 40 Q18 32 20 24 M74 40 Q82 32 80 24" stroke="#A8794A" stroke-width="6" fill="none" stroke-linecap="round"/><ellipse cx="28" cy="46" rx="7" ry="5" fill="#C68A4F"/><ellipse cx="72" cy="46" rx="7" ry="5" fill="#C68A4F"/>`,
  fish:   `<ellipse cx="46" cy="52" rx="26" ry="15" fill="#7CC4F0"/><path d="M70 52 L88 38 L88 66 Z" fill="#5BB8F0"/><circle cx="32" cy="48" r="4" fill="#1B4F8F"/><path d="M40 44 Q48 38 58 42 M42 60 Q50 66 60 62" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  garlic: `<path d="M50 26 Q42 36 36 50 Q30 70 50 78 Q70 70 64 50 Q58 36 50 26 Z" fill="#F6F0E4" stroke="#D9CBB0" stroke-width="3"/><path d="M50 30 V76 M42 40 Q46 60 50 76 M58 40 Q54 60 50 76" stroke="#D9CBB0" stroke-width="2.5" fill="none"/><path d="M50 26 Q52 16 58 12" stroke="#5CB531" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  cave:   `<path d="M20 80 Q20 34 50 30 Q80 34 80 80 Z" fill="#8E7BE5"/><path d="M34 80 Q34 52 50 50 Q66 52 66 80 Z" fill="#3B2F66"/><path d="M44 50 L46 62 M56 52 L54 64" stroke="#C9BEF5" stroke-width="4" stroke-linecap="round"/>`,
  volcano:`<path d="M22 78 Q34 42 44 40 L56 40 Q66 42 78 78 Z" fill="#C68A4F"/><ellipse cx="50" cy="40" rx="9" ry="4" fill="#8E5A2B"/><path d="M30 66 Q40 58 50 66 T70 66" stroke="#A8D158" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  plane:  `<path d="M22 58 L78 42 Q86 40 84 48 L80 52 L40 64 Z" fill="#fff" stroke="#1278C2" stroke-width="4"/><path d="M52 48 L42 30 L52 30 L62 45 Z" fill="#7CC4F0"/><path d="M44 60 L38 72 L46 70 L52 58 Z" fill="#7CC4F0"/><circle cx="74" cy="46" r="3" fill="#1278C2"/>`,
  car:    `<path d="M22 62 Q24 48 36 46 L62 44 Q74 44 78 56 L80 62 Q82 70 74 70 H28 Q20 70 22 62 Z" fill="#5BB8F0" stroke="#1278C2" stroke-width="3.5"/><rect x="38" y="48" width="20" height="11" rx="4" fill="#DFF3FD"/><circle cx="36" cy="70" r="7" fill="#1B4F8F"/><circle cx="66" cy="70" r="7" fill="#1B4F8F"/>`,
  chip:   `<rect x="30" y="30" width="40" height="40" rx="6" fill="#1B4F8F"/><rect x="40" y="40" width="20" height="20" rx="3" fill="#7CC4F0"/><g stroke="#1B4F8F" stroke-width="5" stroke-linecap="round"><path d="M38 30 V18 M50 30 V18 M62 30 V18 M38 70 V82 M50 70 V82 M62 70 V82 M30 38 H18 M30 50 H18 M30 62 H18 M70 38 H82 M70 50 H82 M70 62 H82"/></g>`,
  pottery:`<path d="M38 26 H62 Q58 36 64 44 Q74 56 64 72 Q58 80 50 80 Q42 80 36 72 Q26 56 36 44 Q42 36 38 26 Z" fill="#7FB8A4" stroke="#4E8A75" stroke-width="3"/><path d="M40 50 Q50 44 60 50 M42 60 Q50 55 58 60" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".8"/>`,
  building:`<rect x="30" y="26" width="40" height="56" rx="4" fill="#9CC8E8"/><g fill="#FFF3C9"><rect x="37" y="34" width="9" height="9"/><rect x="54" y="34" width="9" height="9"/><rect x="37" y="50" width="9" height="9"/><rect x="54" y="50" width="9" height="9"/><rect x="44" y="66" width="12" height="16" fill="#1B4F8F"/></g>`,
  strawberry:`<path d="M50 36 Q72 38 70 58 Q66 78 50 82 Q34 78 30 58 Q28 38 50 36 Z" fill="#E2574C"/><g fill="#FFF3C9"><circle cx="42" cy="52" r="2.5"/><circle cx="58" cy="52" r="2.5"/><circle cx="50" cy="64" r="2.5"/><circle cx="40" cy="66" r="2"/><circle cx="60" cy="66" r="2"/></g><path d="M40 36 L50 26 L60 36 L50 40 Z" fill="#2FA34F"/>`,
};
// 지역성 → 스탬프 매핑 (위에서부터 우선)
const STAMP_RULES = [
  [/치즈/,'cheese'], [/녹차|차밭|다향/,'tea'], [/한우|목축|축산/,'cow'],
  [/조선 공업|조선소|항구|항만|포구/,'ship'], [/제철|철강|석유 화학|정유|시멘트/,'factory'],
  [/공항/,'plane'], [/자동차/,'car'], [/반도체|전자|디스플레이|IT|광\(光\)/,'chip'],
  [/사과/,'apple'], [/포도|와인|복분자/,'grape'], [/감귤/,'citrus'], [/딸기/,'strawberry'],
  [/인삼|홍삼|산수유/,'ginseng'], [/마늘|양파/,'garlic'],
  [/갯벌|염전|천일염|대게|꽃게/,'crab'], [/오징어|산천어|재첩|굴비|수산|멸치|전복/,'fish'],
  [/동굴|카르스트|석회/,'cave'], [/화산|오름|용암|주상 절리|분화구/,'volcano'],
  [/눈|동계|스키|설|폭설/,'snow'], [/온천/,'hotspring'],
  [/청자|도자기|옹기/,'pottery'], [/나비|반딧불|생태|습지|늪|철새/,'butterfly'],
  [/불국사|해인사|하회|법주사|사찰|향교|서원|읍성|한옥|고인돌|왕릉|유적|성당|절/,'temple'],
  [/KTX|철도|기차|전철/,'train'], [/등대|다도해|섬|도서/,'lighthouse'],
  [/벼|쌀|평야|곡창|간척/,'rice'], [/혁신도시|도청|행정|신도시|청사/,'building'],
  [/국립 공원|산맥|고원|봉|산$|산지|지리산|설악|덕유|소백/,'mountain'],
];
function stampsOf(loc){
  const text=(loc.fact||'')+' '+(loc.name||'');
  const found=[];
  for(const [re,key] of STAMP_RULES){
    if(re.test(text) && !found.includes(key)) found.push(key);
    if(found.length>=2) break;
  }
  if(!found.length) found.push('mountain');
  return found;
}
function stampSVG(key, x, y, size, flip){
  const art=STAMP_ART[key]||STAMP_ART.mountain;
  return `<g data-stamp="${key}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(size/100*(flip?-1:1)).toFixed(4)},${(size/100).toFixed(4)}) translate(-50,-50)">${art}</g>`;
}

// 아이콘 스타일의 귀여운 땅 캐릭터: 연두 땅 + 흰 외곽선(고정 두께) + 얼굴
function cuteLandSVG(mu, withFace, loc, expr){
  const bb=muniBBox(mu), m=MUNIS[mu];
  const s=Math.sqrt(bb.w*bb.h);          // 기하평균 → 길쭉한 지역도 얼굴 크기 일정
  // 얼굴 비율 (도형 크기에 비례 → 카드마다 같은 느낌)
  const er=s*0.052, gap=s*0.14;
  const fx=m.cx, fy=m.cy;
  const f=n=>n.toFixed(1);
  let face='';
  if(withFace && expr==='happy'){      // 2단계: 신난 표정 (웃는 눈 ⌒⌒ + 벌린 입 + 혀)
    const L=fx-gap/2, R=fx+gap/2, eye=cx=>`<path d="M ${f(cx-er)} ${f(fy)} Q ${f(cx)} ${f(fy-er*1.35)} ${f(cx+er)} ${f(fy)}" fill="none" stroke="#4A3426" stroke-width="${(er*0.42).toFixed(2)}" stroke-linecap="round"/>`;
    face=`<g class="land-face">${eye(L)}${eye(R)}`+
      `<ellipse cx="${f(fx-gap*0.98)}" cy="${f(fy+er*1.25)}" rx="${f(er*0.92)}" ry="${f(er*0.58)}" fill="#FF8F7A" opacity=".72"/>`+
      `<ellipse cx="${f(fx+gap*0.98)}" cy="${f(fy+er*1.25)}" rx="${f(er*0.92)}" ry="${f(er*0.58)}" fill="#FF8F7A" opacity=".72"/>`+
      `<path d="M ${f(fx-er*1.15)} ${f(fy+er*0.85)} Q ${f(fx)} ${f(fy+er*2.9)} ${f(fx+er*1.15)} ${f(fy+er*0.85)} Z" fill="#4A3426"/>`+
      `<path d="M ${f(fx-er*0.55)} ${f(fy+er*1.95)} Q ${f(fx)} ${f(fy+er*2.55)} ${f(fx+er*0.55)} ${f(fy+er*1.95)} Z" fill="#FF8F7A"/></g>`;
  } else if(withFace){                  // 기본(1단계·미니): 차분 표정
    face=`
    <g class="land-face">
      <circle cx="${fx-gap/2}" cy="${fy}" r="${er}" fill="#4A3426"/>
      <circle cx="${fx+gap/2}" cy="${fy}" r="${er}" fill="#4A3426"/>
      <circle cx="${fx-gap/2+er*0.3}" cy="${fy-er*0.35}" r="${er*0.32}" fill="#fff"/>
      <circle cx="${fx+gap/2+er*0.3}" cy="${fy-er*0.35}" r="${er*0.32}" fill="#fff"/>
      <ellipse cx="${fx-gap*0.95}" cy="${fy+er*1.1}" rx="${er*0.85}" ry="${er*0.5}" fill="#FF8F7A" opacity=".65"/>
      <ellipse cx="${fx+gap*0.95}" cy="${fy+er*1.1}" rx="${er*0.85}" ry="${er*0.5}" fill="#FF8F7A" opacity=".65"/>
      <path d="M ${fx-er*0.9} ${fy+er*1.15} Q ${fx} ${fy+er*2.3} ${fx+er*0.9} ${fy+er*1.15}"
            fill="none" stroke="#4A3426" stroke-width="${(er*0.42).toFixed(2)}" stroke-linecap="round"/>
    </g>`;
  }
  // 지역성 스탬프: 주제 일러스트를 땅 주변에 배치
  let stampG='';
  if(withFace && loc){
    const st=stampsOf(loc);
    stampG += stampSVG(st[0], fx+s*0.40, fy-s*0.34, s*0.46, false);
    if(st[1]) stampG += stampSVG(st[1], fx-s*0.42, fy+s*0.34, s*0.36, false);
  }
  return `<svg viewBox="${bb.x.toFixed(0)} ${bb.y.toFixed(0)} ${bb.w.toFixed(0)} ${bb.h.toFixed(0)}" class="card-sil">
    <path d="${m.d}" class="land-shadow" vector-effect="non-scaling-stroke"/>
    <path d="${m.d}" class="land" vector-effect="non-scaling-stroke"/>
    ${face}${stampG}</svg>`;
}
// 도(道) 소속 시·군은 '경북 구미'처럼 도 이름을 함께 표기
const PROV_SHORT={'경기도':'경기','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남',
  '전북특별자치도':'전북','전라남도':'전남','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주'};
function cardDisplayName(loc){
  const mu=loc.accept[0];
  const prov=MUNIS[mu]?.prov||'';
  const base=loc.name.replace(/\(.+\)$/,'');
  const short=PROV_SHORT[prov];
  return short ? `${short} ${base}` : base;
}
function fmtPop(p){
  if(!p) return '';
  if(p>=1e6) return (p/1e4).toFixed(0)+'만';
  if(p>=1e5) return Math.round(p/1e4)+'만';
  return (p/1e4).toFixed(1)+'만';
}
// 카드용 짧은 설명(2줄 이내) — 첫 문장이 길어 잘리는 지역만 큐레이션 오버라이드
const CARD_DESC={
  '하남':'미사·위례·감일 등 대규모 택지 개발로 급성장',
  '성남':'분당(1기)·판교(2기·IT) 신도시의 도시',
  '영월':'감입 곡류 하천(한반도 지형)·청령포의 고장',
  '경주':'신라 천년 고도, 불국사·석굴암의 세계유산 도시',
  '완주':'전주를 둘러싼 혁신도시(농촌진흥청)',
  '인천':'인천국제공항·인천항의 국제 물류 도시',
  '서산':'대산 석유 화학 단지와 천수만 간척지',
  '포천':'한탄강 용암 대지·주상 절리(비둘기낭)',
  '독도':'우리 영토 동쪽 끝, 신생대 화산섬',
  '철원':'현무암 용암 대지(오대쌀)·한탄강 고석정',
  '김제 새만금':'국내 최대 간척 사업, 새만금 방조제',
  '단양':'석회암 카르스트(고수동굴·도담삼봉)·시멘트',
  '청송':'주왕산 국립공원·유네스코 세계 지질공원',
  '화순':'고인돌 세계유산과 운주사 천불천탑',
};
// 인구 라벨 아이콘 — 기기별로 은색 뜨는 이모지 대신 금색 인물(users) SVG
const POP_ICON='<svg class="popicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/></svg>';
function cardHTML(loc, owned, count){
  const mu=loc.accept[0];
  const m=MUNIS[mu]||{};
  const rc=REGION_COLORS[loc.region]||REGION_COLORS['수도권'];
  // 카드 설명: 큐레이션된 짧은 설명이 있으면 사용, 없으면 첫 문장(마침표+공백 기준)
  const meaning=CARD_DESC[loc.name] || (loc.fact||'').split(/\.\s/)[0].trim();
  if(!owned){
    return `<div class="rcard locked">
      <div class="art-window svgart"><div class="card-sil-wrap">${cuteLandSVG(mu,false)}</div></div>
      <div class="rcard-name">???</div><div class="rcard-meaning">${regionLabel(loc.region)} 지방</div></div>`;
  }
  const lv=Math.min(cardLevel(loc.name), CARD_MAX_LV);   // 1 최초 · 2 강화 · 3 최종
  // 강화 단계 핀
  let pins=''; for(let i=0;i<CARD_MAX_LV;i++) pins+=`<i${i<lv?' class="on"':''}></i>`;
  const enhTag = lv>=CARD_MAX_LV ? `<span class="enh-max">MAX</span>` : `<span class="enh-stg">${lv}단계</span>`;
  // 일러스트: 1단계 차분 실루엣 · 2단계 신난+스탬프 · 3단계 그림(card-art)
  let artHTML, winCls;
  if(lv>=CARD_MAX_LV){
    winCls='art-window has-art';
    artHTML=`<img class="card-art" src="card-art-webp/${encodeURIComponent(mu)}.webp?v=2" alt="" onerror="this.closest('.art-window').classList.add('no-art')">`+
            `<div class="card-sil-wrap card-art-fallback">${cuteLandSVG(mu,true,loc,'happy')}</div>`;
  }else{
    winCls='art-window svgart';
    artHTML=`<div class="card-sil-wrap">${lv>=2?cuteLandSVG(mu,true,loc,'happy'):cuteLandSVG(mu,true,null)}</div>`;
  }
  // 특성 뱃지 (일러스트 하단 오버레이, 상세에서만 표시)
  const badges=factBadges(loc).badges;
  const badgeOverlay = badges.length ? `<div class="artbadges">${badges.map(b=>`<span class="cbadge ${b.cls}">${b.t}</span>`).join('')}</div>` : '';
  // 카드 표기명: 보통은 시·군명(mu). 단, 한 muni에 속한 지점(예: 대구광역시에 편입된 군위)은 지점 본래 이름 사용
  const muNoParen=mu.replace(/\(.+\)$/,'');
  const muBase=muNoParen.replace(/(특별자치시|특별자치도|특별시|광역시|시|군)$/,'');
  const locBase=(loc.name||'').replace(/\(.+\)$/,'');
  const isSubPoint=(locBase!==muNoParen && locBase!==muBase);   // 이름이 muni와 무관한 지점(군위·한라산 등)
  const displayName=isSubPoint?loc.name:mu;
  // 인구 + 전국/권역 순위 (지점 카드는 모(母)도시 인구라 표시하지 않음)
  const r=(m.pop&&!isSubPoint)?popRank(mu):null;
  const popBlock = (m.pop&&!isSubPoint) ? `<div class="rcard-pop">`+
    `<div class="poprow"><span class="poplabel">${POP_ICON}인구</span><span class="pop-n">${fmtPop(m.pop)}<small>명</small></span></div>`+
    (r?`<div class="rk"><span class="rk-nat">전국 ${r.nat}위</span><span class="rk-reg">${regionLabel(loc.region)} ${r.reg}위</span></div>`:'')+
    `</div>` : '';
  const provShort=PROV_SHORT[m.prov]||'';
  const provBadge = (provShort&&!isSubPoint) ? `<span class="provbadge">${provShort}</span>` : '';
  return `<div class="rcard tier${lv}" style="--regbg:${rc.bg};--regdeep:${rc.deep}">
    <div class="rcard-fx"></div>
    <div class="rc-top">
      <span class="rc-enh"><span class="enh-bolt">⚡</span><span class="enh-pins">${pins}</span>${enhTag}</span>
      <span class="rcard-reg">${regionLabel(loc.region)}</span>
    </div>
    <div class="${winCls}">${artHTML}${badgeOverlay}</div>
    <div class="rcard-name">${provBadge}<span class="cname-t">${displayName}</span></div>
    <div class="rcard-meaning">${meaning}</div>
    ${popBlock}
    ${count>1?`<div class="rcard-cnt">×${count}</div>`:''}
  </div>`;
}
// 카드 상세 보기: 큰 카드 + 전체 설명 + 실제 이미지(마스코트·명소) 검색 연결
function openCardDetail(loc){
  const modal=$('gacha-modal');
  modal.classList.remove('hidden');
  gachaSetMode(false);
  const card=$('gacha-card');
  card.classList.add('flipped'); card.classList.remove('legend-glow');
  if(cardLevel(loc.name)>=CARD_MAX_LV) card.classList.add('legend-glow');   // 최종 강화 카드 골드 글로우
  $('gcard-front').innerHTML=cardHTML(loc,true,cards[loc.name]||1);
  const pop=MUNIS[loc.accept[0]]?.pop;
  const pr=pop?popRank(loc.accept[0]):null;
  const lv=cardLevel(loc.name), copies=cards[loc.name]||1;
  const enhHTML=`<div class="enh-box"><span class="enh-stars">${starHTML(lv)}</span> <span class="enh-lv">Lv.${lv}</span>`+
    (lv>=CARD_MAX_LV
      ? ` <span class="enh-max">✨ 최대 강화 달성</span>`
      : ` <button class="enh-btn" id="enh-btn" ${copies<ENHANCE_NEED?'disabled':''}>⚡ 강화 (같은 카드 ${Math.min(copies,ENHANCE_NEED)}/${ENHANCE_NEED}장)</button>`)+
    `</div>`+
    (lv<CARD_MAX_LV && copies<ENHANCE_NEED ? `<div class="enh-hint">같은 카드를 ${ENHANCE_NEED}장 모으면 강화할 수 있어요 (현재 ${copies}장)</div>` : '');
  $('gacha-msg').innerHTML=
    `<div style="max-width:300px;margin:0 auto;line-height:1.6"><b>${cardDisplayName(loc)}</b>${pop?` · 인구 약 ${fmtPop(pop)} 명 (전국 ${pr.nat}위 · ${regionLabel(loc.region)} ${pr.reg}위)`:''}<br>${loc.fact}</div>`+
    enhHTML+
    `<div style="margin-top:8px">${imgSearchLink(loc.name.replace(/\(.+\)$/,''),'마스코트')} ${imgSearchLink(loc.name.replace(/\(.+\)$/,''),'관광 명소')}</div>`;
  const eb=$('enh-btn');
  if(eb) eb.onclick=()=>{ if(doEnhance(loc.name)){ openCardDetail(loc); renderCollection(_collFilter); } };
  $('btn-draw-again').classList.add('hidden');
}
// 🗺️ 정복 지도: 수집한 카드의 시·군이 권역 색으로 채워짐
function conquestMapSVG(){
  const ownedMuni=new Set();
  Object.keys(cards).forEach(n=>{
    const l=LOCATIONS.find(x=>x.name===n);
    if(l) l.accept.forEach(a=>ownedMuni.add(a));
  });
  let paths='';
  for(const [name,m] of Object.entries(MUNIS)){
    if(ownedMuni.has(name)){
      const c=(REGION_COLORS[m.region]||{}).map||'#9CC8E8';
      paths+=`<path d="${m.d}" fill="${c}" stroke="#FFFFFF" stroke-width=".7"/>`;
    } else {
      paths+=`<path d="${m.d}" fill="#E9F0F4" stroke="#D3DEE6" stroke-width=".5"/>`;
    }
  }
  let borders='';
  for(const p of Object.values(PROVINCES)) borders+=`<path d="${p.d}" fill="none" stroke="#B9C9D4" stroke-width="1"/>`;
  const total=new Set(LOCATIONS.flatMap(l=>l.accept)).size;
  return {svg:`<svg viewBox="-8 -8 776 822" class="conquest-map">${paths}${borders}</svg>`,
          owned:ownedMuni.size, total};
}
function updateGachaUI(){
  // 자가복구: 어떤 경로로든 coins가 NaN/Infinity가 되면 무한 뽑기·표시 깨짐 → 즉시 정화
  if(!Number.isFinite(coins)){ coins=0; store.save('geo_coins',coins); }
  if(!Number.isFinite(xp)) xp=0;
  if($('coin-cnt')) $('coin-cnt').innerHTML=`<span class="coin-ico"></span> <b>${coins}</b>`;
  if($('coll-progress')) $('coll-progress').textContent=`카드 ${Object.keys(cards).length}/${LOCATIONS.length}장 수집 — 지점 카드 모으기`;
  if($('btn-draw')) $('btn-draw').disabled = coins<DRAW_COST;
  if($('btn-draw10')) $('btn-draw10').disabled = coins<DRAW_COST*10;
}
const coinIco='<span class="coin-ico"></span>';
function drawCard(){
  coins=num(coins);                       // NaN이면 무한 뽑기 방지
  if(coins<DRAW_COST) return null;
  coins-=DRAW_COST; store.save('geo_coins',coins);
  const loc=LOCATIONS[Math.floor(Math.random()*LOCATIONS.length)];   // 균등 뽑기
  const dup=!!cards[loc.name];
  cards[loc.name]=(cards[loc.name]||0)+1;
  if(dup){ coins+=2; store.save('geo_coins',coins); }   // 중복 → 2코인 환급
  store.save('geo_cards',cards);
  updateGachaUI();
  missionProgress({isNew:!dup});
  checkAchievements();
  scheduleSync();
  return {loc, dup};
}
// 뽑기 모달 표시 모드 전환(단일 카드 / 10연속 그리드)
function gachaSetMode(multi){
  $('gacha-card').classList.toggle('hidden', multi);
  $('gacha-multi').classList.toggle('hidden', !multi);
  $('btn-draw-again').classList.toggle('hidden', multi);
  $('btn-draw10-again').classList.toggle('hidden', !multi);
}
function openGacha(){
  const res=drawCard();
  if(!res) return;
  const modal=$('gacha-modal');
  modal.classList.remove('hidden');
  gachaSetMode(false);
  const card=$('gacha-card');
  card.classList.remove('flipped','legend-glow');
  $('gcard-front').innerHTML=cardHTML(res.loc,true,cards[res.loc.name]);
  $('gacha-msg').innerHTML='';
  $('btn-draw-again').disabled=true;   // 애니메이션 중 연타로 추가 뽑기 방지
  setTimeout(()=>{
    card.classList.add('flipped');
    if(!res.dup){ confetti(modal.querySelector('.gacha-stage')); }   // 새 카드면 축하 연출
    $('gacha-msg').innerHTML=
      (res.dup?`이미 가진 카드! <b style="color:var(--gold)">+2${coinIco} 환급</b>`:`<b style="color:var(--sea-d)">NEW!</b> 새로운 지역 카드 획득`)+
      ` · 보유 ${coinIco} ${coins}`;
    $('btn-draw-again').innerHTML=`한 번 더 (5${coinIco})`;
    $('btn-draw-again').disabled = coins<DRAW_COST;
  }, 650);
  try { if(navigator.vibrate) navigator.vibrate(res.dup?30:[40,60,40,60,120]); } catch(e){}
}
// 🎁 10연속 뽑기 — 한 번에 N장
function openGachaMulti(n){
  coins=num(coins);
  if(coins < DRAW_COST*n) return;
  const results=[];
  for(let i=0;i<n;i++){ const r=drawCard(); if(r) results.push(r); }
  if(!results.length) return;
  const modal=$('gacha-modal'); modal.classList.remove('hidden');
  gachaSetMode(true);
  const newCnt=results.filter(r=>!r.dup).length;
  const cells=results.map(r=>{
    const cnt=cards[r.loc.name];
    return `<div class="gm-cell" data-name="${encodeURIComponent(r.loc.name)}">`+
      `<span class="${r.dup?'gm-dup':'gm-new'}">${r.dup?'중복':'NEW'}</span>`+
      cardHTML(r.loc,true,cnt)+`</div>`;
  }).join('');
  $('gacha-multi').innerHTML=`<div class="gm-head">🎁 ${n}연속 결과 — <b>NEW ${newCnt}</b> · 중복 ${n-newCnt}</div><div class="gm-grid">${cells}</div>`;
  $('gacha-multi').querySelectorAll('.gm-cell').forEach(el=>{
    el.onclick=()=>{ const l=LOCATIONS.find(x=>x.name===decodeURIComponent(el.dataset.name)); if(l) openCardDetail(l); };
  });
  $('gacha-msg').innerHTML=`보유 ${coinIco} <b>${coins}</b>`;
  if(newCnt>0) confetti(modal.querySelector('.gacha-stage'));
  $('btn-draw10-again').innerHTML=`10연속 더 (50${coinIco})`;
  $('btn-draw10-again').disabled = coins<DRAW_COST*10;
  try { if(navigator.vibrate) navigator.vibrate([30,40,30,40,30,40,90]); } catch(e){}
}
// ⚡ 강화 한꺼번에 — 강화 가능한 카드를 모두 강화
function doEnhanceAll(){
  let count=0, changed=true;
  while(changed){
    changed=false;
    for(const name of Object.keys(cards)){
      if(canEnhance(name) && doEnhance(name)){ count++; changed=true; }
    }
  }
  return count;
}
function enhanceableCount(){ return Object.keys(cards).filter(canEnhance).length; }
function updateEnhanceAllBtn(){
  const b=$('btn-enhance-all'); if(!b) return;
  const n=enhanceableCount();
  b.classList.toggle('hidden', n===0);
  b.textContent=`⚡ 전체 강화 (${n})`;
}
let _collFilter='전체';
function renderCollection(filter){
  _collFilter=filter;
  const grid=$('cards-grid'); grid.innerHTML='';
  const list=LOCATIONS.filter(l=>filter==='전체'||l.region===filter);
  const popOf=l=>MUNIS[l.accept[0]]?.pop||0;
  const ownedOf=l=>cards[l.name]?1:0;
  // 획득한 카드 먼저, 그 안에서 인구 많은 순
  list.sort((a,b)=> ownedOf(b)-ownedOf(a) || popOf(b)-popOf(a) || a.name.localeCompare(b.name));
  list.forEach(l=>{
    const owned=!!cards[l.name];
    const el=document.createElement('div');
    el.innerHTML=cardHTML(l,owned,cards[l.name]||0);
    const c=el.firstElementChild;
    c.onclick=()=>{ if(owned) openCardDetail(l); };
    grid.appendChild(c);
  });
  const ownedCnt=list.filter(l=>cards[l.name]).length;
  $('coll-title-progress').textContent=`${ownedCnt}/${list.length} · ⚡강화도 ${enhanceScore()}`;
  updateEnhanceAllBtn();
}
function openCollection(){
  show('screen-cards');
  // 정복 지도
  const cq=conquestMapSVG();
  $('conquest-wrap').innerHTML=
    `<div class="conquest-head">🗺️ 나의 지도 정복 <b>${cq.owned}</b>/${cq.total} 시·군</div>`+cq.svg+
    `<div class="map-hint" style="text-align:center">지점 카드 ${LOCATIONS.length}장을 모두 모으면 ${cq.total}개 시·군이 채워집니다<br>(한 시·군에 여러 지점이 있어 카드 수와 시·군 수가 다릅니다)</div>`;
  const chipBox=$('coll-chips'); chipBox.innerHTML='';
  ['전체',...MAP_REGIONS].forEach(r=>{
    const b=document.createElement('button');
    b.className='chip'+(r==='전체'?' on':''); b.textContent=regionLabel(r);
    b.onclick=()=>{ chipBox.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); b.classList.add('on'); renderCollection(r); };
    chipBox.appendChild(b);
  });
  renderCollection('전체');
}

// ============================================================
// 종료 / 결과
// ============================================================
// 연속 학습(스트릭) 기록
function bumpStreak(){
  const today=new Date().toDateString();
  const last=store.load('geo_lastday','');
  if(last===today) return store.load('geo_streak',1);
  const yest=new Date(Date.now()-864e5).toDateString();
  const s=(last===yest)? store.load('geo_streak',0)+1 : 1;
  store.save('geo_lastday',today); store.save('geo_streak',s);
  return s;
}
// 결과 꽃가루
function confetti(host){
  const colors=['#FFD23F','#A4CE4E','#20A2EE','#F2889B','#E2574C'];
  for(let i=0;i<26;i++){
    const s=document.createElement('span');
    s.className='confetti';
    s.style.cssText=`left:${Math.random()*100}%;background:${colors[i%colors.length]};animation-delay:${Math.random()*0.7}s;animation-duration:${1.6+Math.random()*1.2}s;transform:rotate(${Math.random()*360}deg)`;
    host.appendChild(s);
    setTimeout(()=>s.remove(), 3200);
  }
}
function resultComment(acc){
  if(acc>=90) return '이 감각이면 수능장에서도 흔들리지 않겠어요. 만점 가즈아! 🏆';
  if(acc>=70) return '상위권 페이스! 틀린 지역만 탐색 모드로 복습하면 완성 💪';
  if(acc>=50) return '기본기 장착 완료. 빈출 지역부터 한 번 더 돌아봐요 📚';
  return '오늘 틀린 지역이 수능날의 점수가 됩니다. 탐색 모드부터 차근차근! 🌱';
}
function streakComment(n){
  if(n>=25) return '괴물 같은 집중력! 지도가 완전히 손에 익었어요 🏆';
  if(n>=15) return '엄청난 연승! 지리 감각이 폭발하고 있어요 🔥🔥';
  if(n>=8)  return '훌륭해요! 조금만 더 가면 두 자릿수 연승 💪';
  if(n>=3)  return '좋은 출발! 침착하게 한 문제씩 쌓아 봐요 📚';
  return '한 문제에 끝! 다시 도전해서 연승을 쌓아 보세요 🌱';
}

// ============================================================
// 🎮 아케이드 모드 공통 (산성비 / 러너) — 표준 문제 레이아웃 대신 전용 화면 사용
// ============================================================
function enterArcade(title, color){
  show('screen-game');
  $('screen-game').style.setProperty('--mode-c', color||'#1278C2');
  $('game-title').textContent=title;
  $('turn-indicator').classList.add('hidden');
  $('boss-bar').classList.add('hidden');
  $('warmup-tip').classList.add('hidden');
  $('timer-bar-wrap').style.display='none';
  $('game-body').style.display='none';
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>{ const e=$(id); if(e&&e.parentElement) e.parentElement.style.visibility='hidden'; });
  const ap=$('arcade-pane'); ap.className='arcade-pane'; ap.innerHTML=''; return ap;
}
function stopArcade(){
  if(G.arcade){
    if(G.arcade.raf) cancelAnimationFrame(G.arcade.raf);
    (G.arcade.timers||[]).forEach(t=>clearTimeout(t));
    if(G.arcade.cleanup) try{ G.arcade.cleanup(); }catch(e){}
    G.arcade=null;
  }
  const ap=$('arcade-pane'); if(ap){ ap.classList.add('hidden'); ap.innerHTML=''; }
  const tw=$('timer-bar-wrap'); if(tw) tw.style.display='';
  const gb=$('game-body'); if(gb) gb.style.display='';
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>{ const e=$(id); if(e&&e.parentElement) e.parentElement.style.visibility=''; });
}

// ---------- 🌧️ 지역 산성비 ----------
let ACID_THEMES=null;
function acidThemes(){
  if(ACID_THEMES) return ACID_THEMES;
  const baseName=l=>(l.name||'').replace(/\(.+\)$/,'');
  const popOf=l=>(MUNIS[l.accept&&l.accept[0]]||{}).pop||0;
  const isCity=l=>{ const mu=l.accept&&l.accept[0]; if(!mu) return false; const b=mu.replace(/\(.+\)$/,'').replace(/(특별자치시|특별자치도|특별시|광역시|시|군)$/,''); return baseName(l)===b||baseName(l)===mu.replace(/\(.+\)$/,''); };
  const CITY=LOCATIONS.filter(isCity);   // 지점(한라산·군위 등) 제외, 실제 시·군만
  // ── 수능특강·수능완성 [제조업] 파트 기준 공업 도시 (지역별 종합정리 산업·공업) ──
  const CAR  =['평택','화성','아산','광주광역시','울산','대구'];        // 자동차(부품 포함)
  const ELEC =['수원','이천','용인','평택','아산','파주','구미'];        // 전자·반도체·디스플레이
  const STEEL=['포항','광양','당진'];                                   // 제철(1차 금속)
  const CHEM =['울산','여수','서산'];                                   // 석유 화학
  const SHIP =['울산','거제','영암'];                                   // 조선
  const CEMENT=['동해','삼척','단양','제천'];                           // 시멘트(석회암 산지)
  const MACH =['창원','천안','대구'];                                   // 기계
  const NUKE =['경주','울진','영광','부산'];                            // 원자력(월성·한울·한빛·고리)
  const KTX  =['대전','천안','청주','김천','대구','부산','울산','익산','광주광역시','목포','평창','강릉','경주']; // KTX 정차
  const f=l=>l.fact||'';
  const mk=(label,test)=>{ const members=CITY.filter(test); return {label, members, set:new Set(members.map(l=>l.name))}; };
  ACID_THEMES={ pool:CITY, themes:[
    // ── 행정·도시 ──
    mk('🏙️ 수도권 도시', l=>l.region==='수도권'),
    mk('🌲 강원권 도시', l=>l.region==='강원'),
    mk('🌾 충청권 도시', l=>l.region==='충청'),
    mk('🌻 호남권 도시', l=>l.region==='호남'),
    mk('🏔️ 영남권 도시', l=>l.region==='영남'),
    mk('🏢 광역시', l=>/광역시/.test(l.accept&&l.accept[0]||'')),
    mk('🏛️ 도청 소재지', l=>/도청/.test(f(l))),
    mk('⭐ 특례시', l=>TEUKRYE.includes(baseName(l))),
    mk('👥 인구 100만 이상 도시', l=>popOf(l)>=1000000),
    mk('🏢 혁신·기업도시', l=>/혁신도시|기업도시/.test(f(l))),
    mk('🛡️ 접경 지역 도시', l=>/접경|비무장|DMZ|분단/.test(f(l))),
    // ── 공업 (수능특강·수능완성 제조업) ──
    mk('🚗 자동차 공업 도시', l=>CAR.includes(baseName(l))),
    mk('💻 전자·반도체 도시', l=>ELEC.includes(baseName(l))),
    mk('🏭 제철 공업 도시', l=>STEEL.includes(baseName(l))),
    mk('🛢️ 석유 화학 도시', l=>CHEM.includes(baseName(l))),
    mk('🚢 조선 공업 도시', l=>SHIP.includes(baseName(l))),
    mk('🧱 시멘트 공업 도시', l=>CEMENT.includes(baseName(l))),
    mk('⚙️ 기계 공업 도시', l=>MACH.includes(baseName(l))),
    mk('🏗️ 국가 산업 단지 도시', l=>/국가 ?산업 ?단지/.test(f(l))),
    // ── 자원·발전·교통 ──
    mk('⚡ 원자력 발전 도시', l=>NUKE.includes(baseName(l))),
    mk('⛏️ 석탄·폐광 도시', l=>/폐광|석탄|탄광|광산/.test(f(l))),
    mk('⚓ 항구·무역항 도시', l=>/무역항|항만|항구/.test(f(l))),
    mk('✈️ 공항이 있는 도시', l=>/공항/.test(f(l))),
    mk('🚄 KTX 정차 도시', l=>KTX.includes(baseName(l))),
    // ── 지형·자연 ──
    mk('🌊 간척지가 있는 도시', l=>/간척/.test(f(l))),
    mk('🌋 화산·용암 지형', l=>/화산|용암|칼데라|주상 ?절리|순상|현무암/.test(f(l)) || ['제주시'].includes(baseName(l))),
    mk('🪨 석회암·카르스트 지형', l=>/석회암|카르스트|돌리네|석회 ?동굴|고수동굴/.test(f(l))),
    mk('🦆 갯벌·습지 도시', l=>/갯벌|람사르|습지|우포/.test(f(l))),
    mk('🏞️ 국립공원 도시', l=>/국립 ?공원/.test(f(l))),
    mk('🌄 고원·고위평탄면 도시', l=>/고원|고위 ?평탄면|고랭지/.test(f(l))),
    mk('⛷️ 동계 스포츠·올림픽 도시', l=>/스키|리조트|동계|올림픽/.test(f(l))),
    // ── 문화·관광 ──
    mk('🏯 유네스코 세계유산', l=>UNESCO_CITY.includes(baseName(l))),
    mk('🎏 축제로 유명한 도시', l=>/축제|문화제|예술제|나비|머드|불꽃/.test(f(l))),
  ].filter(t=>t.members.length>=3 && t.members.length<=CITY.length*0.7) };
  return ACID_THEMES;
}
function startAcidRain(){
  G.mode='acidrain'; G.score=0; G.combo=0; G.maxCombo=0; G.correctCnt=0; G.idx=0;
  const ap=enterArcade('🌧️ 지역 산성비','#5B8DEF');
  ap.innerHTML=
    '<div class="acid-hud">'+
      '<div class="acid-theme" id="acid-theme"></div>'+
    '</div>'+
    '<div class="acid-bar">'+
      '<span class="acid-big score">⭐ 점수 <b id="acid-score">0</b></span>'+
      '<span class="acid-big combo">🔥 콤보 <b id="acid-combo">0</b></span>'+
      '<span class="acid-big time">⏱️ <b id="acid-time">60</b>초</span>'+
    '</div>'+
    '<div class="acid-field" id="acid-field"><div class="acid-sky" id="acid-sky"><div class="acid-sun"></div><div class="acid-clouds"></div></div></div>'+
    '<div class="acid-tip"><b>주제에 맞는 지역만 터치!</b> · 배경이 바뀌면 새 주제 기준 · 오답 −5점</div>';
  const field=$('acid-field');
  const {themes, pool}=acidThemes();
  // ⚠️ score·combo 반드시 0으로 초기화(미초기화 시 undefined+N=NaN → 점수 NaN·코인 NaN 전파)
  const st={score:0, combo:0, time:60.0, cards:[], theme:null, themeQueue:[], decoys:[], doneAt:null, spawnAcc:0, spawnGap:1.2, fall:50, last:0, over:false, sinceTheme:0, transition:0, idc:0};
  G.arcade={raf:0, timers:[], cleanup:()=>{ st.cards.forEach(c=>c.el&&c.el.remove()); }};
  const setScore=()=>{ $('acid-score').textContent=st.score; };
  const setCombo=()=>{ $('acid-combo').textContent=st.combo; };
  const shuffle=a=>{ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  const setThemeProgress=()=>{
    const next=$('acid-next'); if(!next) return;
    next.textContent=st.transition>0 ? '새 주제 준비 중' : '남은 정답 지역 '+Math.max(0,st.themeQueue.length)+'개';
  };
  const themeScene=(label)=>{
    if(/수도권|광역시|인구|특례|도청|혁신|기업/.test(label)) return 'city';
    if(/자동차|전자|반도체|제철|석유|화학|조선|시멘트|기계|산업/.test(label)) return 'industry';
    if(/항구|무역항|공항|KTX/.test(label)) return 'transport';
    if(/화산|용암|석회암|카르스트|갯벌|습지|국립공원|고원|간척|동계|스포츠/.test(label)) return 'nature';
    if(/유네스코|축제|문화|관광/.test(label)) return 'culture';
    return 'default';
  };
  const themeNotice=(label)=>{
    const b=document.createElement('div');
    b.className='acid-theme-pop';
    b.innerHTML='<small>주제 전환!</small><b>'+label+'</b><em>새 기준으로 다시 시작</em>';
    field.appendChild(b);
    setTimeout(()=>b.remove(),1500);
  };
  const newTheme=()=>{
    let t; do{ t=themes[Math.floor(Math.random()*themes.length)]; }while(themes.length>1 && t===st.theme);
    st.theme=t; st.sinceTheme=0;
    st.themeQueue=shuffle(t.members.slice());
    st.decoys=pool.filter(l=>!t.set.has(l.name));
    if(!st.decoys.length) st.decoys=pool.slice();
    st.doneAt=null;
    st.transition=1.35;
    st.spawnAcc=0;
    st.cards.forEach(c=>{ c.dead=true; c.el&&c.el.remove(); });
    st.cards=[];
    const el=$('acid-theme'); el.innerHTML='<small id="acid-next"></small><span>주제</span> <b>'+t.label+'</b>';
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    const scene=themeScene(t.label);
    field.className='acid-field scene-'+scene+' changing';
    G.arcade.timers.push(setTimeout(()=>field.classList.remove('changing'),900));
    // 날씨 모션: 주제가 바뀌면 배경·하늘이 확 바뀌어 기준 변경을 눈으로 확인
    const sky=$('acid-sky'); if(sky){ sky.classList.add('cloudy'); G.arcade.timers.push(setTimeout(()=>sky.classList.remove('cloudy'),1200)); }
    themeNotice(t.label);
    setThemeProgress();
  };
  const spawn=()=>{
    const mustFinish = st.themeQueue.length>0;
    const useMember = mustFinish && (Math.random()<0.72 || st.sinceTheme>8);
    let l;
    if(useMember){
      l=st.themeQueue.shift();
      if(st.themeQueue.length===0) st.doneAt=st.sinceTheme;
      setThemeProgress();
    } else {
      const src=st.decoys.length ? st.decoys : pool;
      l=src[Math.floor(Math.random()*src.length)];
    }
    const w=84; const x=Math.random()*(Math.max(60,field.clientWidth-w));
    const el=document.createElement('button');
    el.className='acid-card';
    el.textContent=l.name;
    el.style.left=x+'px'; el.style.top='-46px';
    const card={el, x, y:-46, name:l.name, dead:false, id:st.idc++};
    // pointerdown: 움직이는 카드는 click이 모바일에서 취소될 수 있어 즉시 반응
    // 정답 여부는 '탭하는 순간의 현재 주제'로 판정 → 주제가 바뀌면 화면의 기존 카드도 새 주제 기준으로 맞히면 정답
    const tap=(e)=>{ e.preventDefault(); e.stopPropagation(); if(card.dead||st.over||st.transition>0) return; card.dead=true;
      const isMatch = st.theme.set.has(card.name);
      if(isMatch){ const add=Math.round(10+st.combo*2); st.combo++; G.combo=st.combo; G.maxCombo=Math.max(G.maxCombo,st.combo); G.correctCnt++; G.idx++; st.score+=add; setScore(); setCombo(); el.classList.add('pop-ok'); popText(el,'+'+add+(st.combo>=3?' 콤보!':''),true); }
      else { st.combo=0; G.combo=0; G.idx++; st.score=Math.max(0,st.score-5); setScore(); setCombo(); el.classList.add('pop-bad'); popText(el,'−5',false); field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake'); }
      setTimeout(()=>el.remove(),200);
    };
    el.addEventListener('pointerdown', tap, {passive:false});
    field.appendChild(el); st.cards.push(card);
  };
  const popText=(near,txt,ok)=>{ const p=document.createElement('span'); p.className='acid-pop'+(ok?'':' bad'); p.textContent=txt; p.style.left=near.style.left; p.style.top=near.style.top; field.appendChild(p); setTimeout(()=>p.remove(),700); };
  const finish=()=>{ if(st.over) return; st.over=true; G.score=st.score; setTimeout(()=>endGame(),350); };
  const loop=(ts)=>{
    if(st.over) return;
    if(!st.last) st.last=ts;
    let dt=(ts-st.last)/1000; if(dt>0.05) dt=0.05; st.last=ts;
    if(st.transition>0){
      st.transition=Math.max(0,st.transition-dt);
      setThemeProgress();
      if(!st.over) G.arcade.raf=requestAnimationFrame(loop);
      return;
    }
    st.time-=dt; if(st.time<=0){ st.time=0; $('acid-time').textContent='0'; return finish(); }
    $('acid-time').textContent=Math.ceil(st.time);
    // 난이도 완만 상승(하트 없음 — 60초 점수 누적)
    const prog=Math.min(1,(60-st.time)/55);
    const fall=st.fall+prog*45, gap=st.spawnGap-prog*0.3;
    st.sinceTheme+=dt;
    if(st.doneAt!==null && st.sinceTheme-st.doneAt>=1.4){
      newTheme();
      if(!st.over) G.arcade.raf=requestAnimationFrame(loop);
      return;
    }
    setThemeProgress();
    st.spawnAcc+=dt; if(st.spawnAcc>=gap){ st.spawnAcc=0; spawn(); }
    const H=field.clientHeight;
    for(const c of st.cards){
      if(c.dead) continue;
      c.y+=fall*dt; c.el.style.top=c.y+'px';
      if(c.y>H-10){ c.dead=true; c.el.remove(); }   // 놓쳐도 감점 없음
    }
    st.cards=st.cards.filter(c=>!c.dead);
    if(!st.over) G.arcade.raf=requestAnimationFrame(loop);
  };
  newTheme(); setScore(); setCombo();
  G.arcade.raf=requestAnimationFrame(loop);
}

// ---------- 🏃 지리 러너 ----------
function runnerQuestions(n){
  // 2지선다 문항: 도청/혁신/유네스코/특례시/수도권 등 테마에서 정답 1 + 오답 1
  const baseName=l=>(l.name||'').replace(/\(.+\)$/,'');
  const {themes}=acidThemes();
  const qs=[];
  for(let i=0;i<n;i++){
    const t=themes[Math.floor(Math.random()*themes.length)];
    if(t.members.length<1) { i--; continue; }
    const correct=t.members[Math.floor(Math.random()*t.members.length)];
    const others=t.pool? t.pool : LOCATIONS;
    let wrong; let guard=0;
    do{ wrong=LOCATIONS[Math.floor(Math.random()*LOCATIONS.length)]; guard++; }while(guard<30 && (t.set.has(wrong.name)||wrong.name===correct.name));
    const ans=[{name:baseName(correct),ok:true},{name:baseName(wrong),ok:false}];
    if(Math.random()<0.5) ans.reverse();
    qs.push({q:t.label.replace(/^\S+\s/,'')+'에 해당하는 곳은?', a:ans});
  }
  return qs;
}
function startRunner(){
  G.mode='runner'; G.score=0; G.combo=0; G.maxCombo=0; G.correctCnt=0; G.idx=0;
  const ap=enterArcade('🏃 지리 러너','#16A34A');
  ap.classList.add('runner-pane');
  ap.innerHTML=
    '<div class="run-hud"><span id="run-lives" class="acid-lives"></span>'+
      '<span class="acid-chip"><span class="run-label">SCORE</span>⭐ <b id="run-score">0</b></span>'+
      '<span class="acid-chip"><span class="run-label">DIST</span>🏁 <b id="run-dist">0</b>m</span></div>'+
    '<div class="run-stage" id="run-stage">'+
      '<canvas id="run-canvas"></canvas>'+
      '<div class="run-q hidden" id="run-q"></div>'+
    '</div>'+
    '<div class="run-ctrl"><button class="run-btn" id="run-left">◀</button><button class="run-btn" id="run-right">▶</button></div>'+
    '<div class="acid-tip">◀▶(또는 화면 좌·우 터치)로 차선 이동 · 장애물 피하고, 갈림길에서 <b>정답 차선</b>으로!</div>';
  const stage=$('run-stage'), cv=$('run-canvas'), ctx=cv.getContext('2d',{alpha:false});
  const LANES=3, PT=0.94;        // PT: 플레이어가 위치한 깊이(0=지평선,1=화면 맨 앞)
  const GATE_SPEED=0.58;         // 문제 갈림길은 읽고 판단할 시간을 주기 위해 일반 장애물보다 천천히 접근
  const RUNNER_SCENES=[
    {label:'수도권 도시', src:'runner-bg/runner-bg-seoul-v2.jpg'},
    {label:'부산 해안', src:'runner-bg/runner-bg-busan-v2.jpg'},
    {label:'제주 화산섬', src:'runner-bg/runner-bg-jeju-v2.jpg'},
    {label:'경주 역사길', src:'runner-bg/runner-bg-gyeongju-v2.jpg'}
  ];
  const runBgImgs=RUNNER_SCENES.map(s=>{ const img=new Image(); img.decoding='async'; img.src=s.src; return img; });
  const st={lives:5, maxLives:5, lane:1, leanX:0, dist:0, score:0, combo:0, items:[], spawnAcc:0, last:0, over:false, anim:0,
            gate:null, gateTimer:4.5, gatePrep:0, gatePending:false, invuln:0, bump:0, qs:runnerQuestions(80), qi:0, W:0, H:0, hz:0, scroll:0};
  G.arcade={raf:0, timers:[], cleanup:()=>{}};
  // 정적 그라데이션은 resize 때 1회만 생성(매 프레임 createGradient 방지)
  const buildGrads=()=>{ const W=st.W,H=st.H,hz=st.hz,rh1=W*0.47;
    let rg=ctx.createLinearGradient(W/2-rh1,0,W/2+rh1,0); rg.addColorStop(0,'#3A424B'); rg.addColorStop(.5,'#535D67'); rg.addColorStop(1,'#3A424B'); st.gRoad=rg;
    let ti=ctx.createLinearGradient(0,hz,0,H); ti.addColorStop(0,'rgba(79,172,67,.10)'); ti.addColorStop(1,'rgba(69,150,55,.30)'); st.gTint=ti;
    let sk=ctx.createLinearGradient(0,0,0,hz+20); sk.addColorStop(0,'#4FA8EE'); sk.addColorStop(1,'#CFEBFF'); st.gSky=sk;
    let gs=ctx.createLinearGradient(0,hz,0,H); gs.addColorStop(0,'#5FB544'); gs.addColorStop(1,'#92D85C'); st.gGrass=gs; };
  const resize=()=>{ const r=stage.getBoundingClientRect(); const W=Math.max(1,Math.round(r.width)), H=Math.max(1,Math.round(r.height));
    if(W===st.W && Math.abs(H-(st.H||0))<=8) return;   // 너비 동일 + 높이 미세변동(모바일 주소창 등)은 무시 → 캔버스·캐시 재생성 안 함
    st.W=cv.width=W; st.H=cv.height=H; st.hz=Math.round(H*0.33); st.bgCache=[]; buildGrads(); };
  resize();
  let rzT=0; const onResize=()=>{ clearTimeout(rzT); rzT=setTimeout(resize, 220); };   // 디바운스: 리사이즈 폭주 시 끝난 뒤 1회만 처리
  window.addEventListener('resize', onResize);
  G.arcade.cleanup=()=>{ window.removeEventListener('resize',onResize); clearTimeout(rzT); };
  // ── 3D 원근 투영 ──
  const roadHalf=t=>{ const top=st.W*0.05, bot=st.W*0.47; return top+(bot-top)*t*t; };
  const projY=t=> st.hz + (st.H-st.hz)*t*t;
  const laneX=(lane,t)=> st.W/2 + (lane-1)*(roadHalf(t)*2/3);
  const scaleAt=t=> 0.22+0.95*t*t;

  const lives=()=>{ $('run-lives').innerHTML='<span class="life-on">'+'♥'.repeat(Math.max(0,st.lives))+'</span><span class="life-off">'+'♡'.repeat(Math.max(0,st.maxLives-st.lives))+'</span>'; };
  const move=(d)=>{ if(st.over) return; const nl=Math.max(0,Math.min(LANES-1,st.lane+d));
    if(nl===st.lane && (st.lane===0||st.lane===LANES-1)) st.bump=d*0.6;   // 끝 차선: 더 못 감 → 벽에 살짝 걸림(하트 안 깎임)
    st.lane=nl; };
  // 입력은 pointerdown으로 통일 + 기본동작 차단(클릭 지연·중복·스크롤 방지 → 터치 안정화)
  const btnL=$('run-left'), btnR=$('run-right');
  const onL=(e)=>{ e.preventDefault(); move(-1); }, onR=(e)=>{ e.preventDefault(); move(1); };
  btnL.addEventListener('pointerdown', onL); btnR.addEventListener('pointerdown', onR);
  const tapMove=(e)=>{ e.preventDefault(); const r=stage.getBoundingClientRect(); const cx=(e.clientX!=null?e.clientX:(e.touches&&e.touches[0]?e.touches[0].clientX:0)); move(cx-r.left < r.width/2 ? -1 : 1); };
  stage.addEventListener('pointerdown', tapMove, {passive:false});
  const prevCleanup=G.arcade.cleanup; G.arcade.cleanup=()=>{ prevCleanup&&prevCleanup(); stage.removeEventListener('pointerdown',tapMove); btnL.removeEventListener('pointerdown',onL); btnR.removeEventListener('pointerdown',onR); };
  const finish=()=>{ if(st.over)return; st.over=true; G.score=st.score; setTimeout(()=>endGame(),350); };
  const spawnObstacle=()=>{ const lane=Math.floor(Math.random()*LANES); st.items.push({type:'ob', lane, t:0}); };
  const startGatePrep=()=>{ if(st.gatePending||st.gate) return; st.gatePending=true; st.gatePrep=1.25; banner('갈림길 준비!',true); };
  const spawnGate=()=>{ if(st.qi>=st.qs.length) st.qi=0; const q=st.qs[st.qi++];
    st.gatePending=false; st.gatePrep=0; st.items=[];        // 준비 구간 뒤 남은 장애물만 정리
    const okLane = q.a[0].ok ? 0 : 2; const badLane = okLane===0?2:0;
    const okName=q.a.find(a=>a.ok).name, badName=q.a.find(a=>!a.ok).name;
    st.gate={t:0, q, okLane, badLane, passed:false, okName, badName};
    // 상단에 문제 + 양쪽 선지를 모두 표시(달려오는 표지판은 잘 안 보여서)
    const leftCity = okLane===0 ? okName : badName;
    const rightCity = okLane===2 ? okName : badName;
    const box=$('run-q'); box.classList.remove('hidden');
    box.innerHTML='<b>'+q.q+'</b>'+
      '<div class="run-choices"><span class="run-ch left">◀ '+leftCity+'</span>'+
      '<span class="run-ch right">'+rightCity+' ▶</span></div>';
  };
  lives();
  const loop=(ts)=>{
    if(st.over) return;
    if(!st.last) st.last=ts; let dt=(ts-st.last)/1000; if(dt>0.05) dt=0.05; st.last=ts;
    const sp=0.30 + Math.min(0.20, st.dist*0.00016);          // 깊이 단위 속도(천천히, 완만한 가속)
    st.dist+=sp*62*dt; $('run-dist').textContent=Math.floor(st.dist);
    st.scroll=(st.scroll+sp*dt)%1; st.anim+=dt;
    if(st.invuln>0) st.invuln-=dt;
    if(st.bump) st.bump*=Math.max(0,1-dt*6);
    // 플레이어 차선 보간(즉각적이되 부드럽게)
    st.leanX += ((st.lane-1)-st.leanX)*Math.min(1,dt*16);
    // 스폰
    if(!st.gate && !st.gatePending) st.gateTimer-=dt;
    if(!st.gate && !st.gatePending && st.gateTimer<=0) startGatePrep();
    if(st.gatePending){
      st.gatePrep=Math.max(0,st.gatePrep-dt);
      if(st.gatePrep<=0 && st.items.length===0){ spawnGate(); st.gateTimer=7+Math.random()*3; }
    }
    st.spawnAcc+=dt;
    if(!st.gate && !st.gatePending && st.spawnAcc>1.25){ st.spawnAcc=0;
      if(Math.random()<0.65) spawnObstacle(); }
    // 진행
    for(const it of st.items){ it.t+=sp*dt; }
    for(const it of st.items){ if(it.dead) continue;
      // 충돌은 캐릭터가 '보이는 위치'(leanX) 기준 — 차선 이동 중 판정이 화면과 어긋나지 않게
      if(it.t>0.88 && it.t<1.0 && st.invuln<=0 && Math.abs(st.leanX-(it.lane-1))<0.5){ it.dead=true; st.invuln=1.2; st.lives--; lives(); flash(); if(st.lives<=0) return finish(); } }
    st.items=st.items.filter(it=>!it.dead && it.t<1.12);
    // 갈림길(게이트) — 오답도 하트를 깎아 5번 실수하면 종료
    if(st.gate){ st.gate.t+=sp*GATE_SPEED*dt;
      if(!st.gate.passed && st.gate.t>=0.9){ st.gate.passed=true;
        const ok = st.lane===st.gate.okLane;
        if(ok){ st.combo++; G.maxCombo=Math.max(G.maxCombo,st.combo); G.correctCnt++; st.score+=40; banner('정답! +40',true); }
        else { st.combo=0; st.score=Math.max(0,st.score-10); st.lives--; lives(); flash(); banner('오답! 정답은 '+st.gate.okName,false); }
        G.idx++; $('run-score').textContent=st.score;
        if(st.lives<=0) return finish();
      }
      if(st.gate.t>1.06){ st.gate=null; $('run-q').classList.add('hidden'); }
    }
    st.score=Math.max(st.score, Math.floor(st.dist)); $('run-score').textContent=st.score;
    draw();
    if(!st.over) G.arcade.raf=requestAnimationFrame(loop);
  };
  const flash=()=>{ stage.classList.remove('hitflash'); void stage.offsetWidth; stage.classList.add('hitflash'); };
  const banner=(txt,ok)=>{ const b=document.createElement('div'); b.className='run-banner'+(ok?' ok':' bad'); b.textContent=txt; stage.appendChild(b); setTimeout(()=>b.remove(),900); };
  // ── 그리기(원근 3D · 일러스트 스타일) ──
  const groundShadow=(x,y,rx,ry,a)=>{ ctx.fillStyle='rgba(22,38,22,'+a+')'; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,7); ctx.fill(); };
  const fitCanvasText=(txt,x,y,maxW,size,weight='900',color='#fff')=>{
    ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle';
    let fs=size; ctx.font=weight+' '+Math.round(fs)+'px sans-serif';
    while(fs>9 && ctx.measureText(txt).width>maxW){ fs-=1; ctx.font=weight+' '+Math.round(fs)+'px sans-serif'; }
    ctx.fillText(txt,x,y);
  };
  const drawTree=(side,t)=>{ const s=scaleAt(t); if(s<0.12) return; const y=projY(t);
    const x=st.W/2 + side*(roadHalf(t) + (30+18*s)*s);
    if(x<-30||x>st.W+30) return;
    groundShadow(x, y+2*s, 13*s, 4.5*s, .16);
    ctx.fillStyle='#80522F'; roundRect(ctx,x-3*s, y-20*s, 6*s, 22*s, 2*s); ctx.fill();
    ctx.fillStyle='#3E963A'; ctx.beginPath(); ctx.arc(x, y-30*s, 17*s,0,7); ctx.fill();
    ctx.fillStyle='#5BBE4A'; ctx.beginPath(); ctx.arc(x-8*s, y-25*s, 12*s,0,7); ctx.arc(x+9*s, y-27*s, 11*s,0,7); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.22)'; ctx.beginPath(); ctx.arc(x-6*s, y-36*s, 6*s,0,7); ctx.fill(); };
  const drawObstacle=(lane,t)=>{ const x=laneX(lane,t), y=projY(t), s=scaleAt(t);
    const danger=t>0.62, pulse=danger?(0.5+0.5*Math.sin(st.anim*11)):0;
    // 바닥 그림자 = 충돌 범위(가까워지면 빨갛게 점멸)
    if(danger){ ctx.fillStyle='rgba(228,72,60,'+(0.32+0.4*pulse)+')'; ctx.beginPath(); ctx.ellipse(x,y+13*s,24*s,8*s,0,0,7); ctx.fill();
      ctx.strokeStyle='rgba(228,72,60,'+(0.55+0.45*pulse)+')'; ctx.lineWidth=2.5*s; ctx.beginPath(); ctx.ellipse(x,y+13*s,26*s,9*s,0,0,7); ctx.stroke(); }
    else { groundShadow(x,y+13*s,22*s,7*s,.26); }
    // 바리케이드(다리 + 사선 줄무늬 보드 + ⚠)
    const bw=38*s, bh=30*s, by=y-bh-3*s;
    ctx.fillStyle='#3A4049'; ctx.fillRect(x-bw/2+4*s,by+bh-2*s,4*s,14*s); ctx.fillRect(x+bw/2-8*s,by+bh-2*s,4*s,14*s);
    const g=ctx.createLinearGradient(0,by,0,by+bh); g.addColorStop(0,'#FFC24A'); g.addColorStop(1,'#F4731F');
    ctx.fillStyle=g; roundRect(ctx,x-bw/2,by,bw,bh,7*s); ctx.fill();
    ctx.save(); roundRect(ctx,x-bw/2,by,bw,bh,7*s); ctx.clip();
    ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=5*s;
    for(let i=-2;i<6;i++){ ctx.beginPath(); ctx.moveTo(x-bw/2+i*13*s,by+bh); ctx.lineTo(x-bw/2+i*13*s+bh,by); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2.5*s; roundRect(ctx,x-bw/2,by,bw,bh,7*s); ctx.stroke();
    ctx.fillStyle='#3A2A10'; ctx.font='800 '+Math.round(16*s)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('⚠',x,by+bh/2+1*s); };
  const drawSign=(name,lane,t)=>{ const x=laneX(lane,t), y=projY(t), s=scaleAt(t); if(s<0.12) return;
    ctx.font='900 '+Math.round(18*s)+'px sans-serif';
    const w=Math.min(118*s, Math.max(84*s, ctx.measureText(name).width+26*s)), h=40*s, py=y-62*s;
    groundShadow(x,y+2*s,9*s,3.5*s,.14);
    ctx.strokeStyle='#DCE5EC'; ctx.lineWidth=4*s; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,py+h); ctx.stroke();
    ctx.fillStyle='rgba(5,30,18,.24)'; roundRect(ctx,x-w/2+4*s,py+5*s,w,h,10*s); ctx.fill();
    const g=ctx.createLinearGradient(0,py,0,py+h); g.addColorStop(0,'#2DD86D'); g.addColorStop(.55,'#169C4A'); g.addColorStop(1,'#0D6937');
    ctx.fillStyle=g; roundRect(ctx,x-w/2,py,w,h,10*s); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.95)'; ctx.lineWidth=2.7*s; roundRect(ctx,x-w/2,py,w,h,10*s); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.22)'; roundRect(ctx,x-w/2+5*s,py+5*s,w-10*s,8*s,4*s); ctx.fill();
    fitCanvasText(name,x,py+h/2,w-12*s,18*s,'900','#fff'); };
  const drawChar=()=>{
    const s=scaleAt(PT), px=st.W/2+(st.leanX+st.bump)*(roadHalf(PT)*2/3);
    const bob=(0.5+0.5*Math.sin(st.anim*11))*8*s, cy=projY(PT)-bob;
    const shS=1-bob/(8*s)*0.35;
    groundShadow(px, projY(PT)+24*s, 24*s*shS, 7*s*shS, .28);
    if(st.invuln>0 && Math.floor(st.invuln*12)%2===0) return;
    const lp=Math.sin(st.anim*13);
    ctx.save(); ctx.translate(px,cy); ctx.rotate(st.leanX*0.13);
    // 다리·운동화
    ctx.strokeStyle='#115B3A'; ctx.lineWidth=6*s; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-8*s,13*s); ctx.lineTo(-14*s,23*s+Math.max(0,lp)*5*s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8*s,13*s); ctx.lineTo(14*s,23*s+Math.max(0,-lp)*5*s); ctx.stroke();
    ctx.fillStyle='#FFFFFF'; roundRect(ctx,-21*s,24*s+Math.max(0,lp)*5*s,15*s,6*s,3*s); ctx.fill();
    roundRect(ctx,6*s,24*s+Math.max(0,-lp)*5*s,15*s,6*s,3*s); ctx.fill();
    ctx.fillStyle='#FFD23F'; roundRect(ctx,-20*s,27*s+Math.max(0,lp)*5*s,14*s,2*s,1*s); ctx.fill();
    roundRect(ctx,7*s,27*s+Math.max(0,-lp)*5*s,14*s,2*s,1*s); ctx.fill();
    // 팔: 지도를 들고 뛰는 느낌
    ctx.strokeStyle='#12834B'; ctx.lineWidth=6*s; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-17*s,-4*s); ctx.lineTo(-25*s,-10*s+lp*5*s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17*s,-3*s); ctx.lineTo(25*s,-9*s-lp*5*s); ctx.stroke();
    ctx.fillStyle='#FFF5C4'; ctx.strokeStyle='#2B7A52'; ctx.lineWidth=1.8*s;
    ctx.save(); ctx.translate(-30*s,-15*s+lp*5*s); ctx.rotate(-0.18);
    roundRect(ctx,-8*s,-6*s,16*s,12*s,2*s); ctx.fill(); ctx.stroke();
    ctx.strokeStyle='#60A5FA'; ctx.lineWidth=1.1*s; ctx.beginPath(); ctx.moveTo(-5*s,-2*s); ctx.lineTo(1*s,2*s); ctx.lineTo(6*s,-3*s); ctx.stroke();
    ctx.restore();
    // 지도 핀 몸통
    const body=ctx.createLinearGradient(0,-31*s,0,20*s); body.addColorStop(0,'#2DD86D'); body.addColorStop(.58,'#16A34A'); body.addColorStop(1,'#0F6F3D');
    ctx.fillStyle=body; ctx.strokeStyle='#FFFFFF'; ctx.lineWidth=3*s;
    ctx.beginPath();
    ctx.moveTo(0,23*s);
    ctx.bezierCurveTo(-21*s,4*s,-22*s,-18*s,-8*s,-28*s);
    ctx.bezierCurveTo(0,-34*s,14*s,-31*s,20*s,-19*s);
    ctx.bezierCurveTo(27*s,-4*s,14*s,11*s,0,23*s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 얼굴/나침반 렌즈
    ctx.fillStyle='#EAF7CB'; ctx.beginPath(); ctx.ellipse(0,-10*s,13*s,12*s,0,0,7); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.75)'; ctx.lineWidth=1.8*s; ctx.beginPath(); ctx.arc(0,-10*s,10*s,0,7); ctx.stroke();
    ctx.fillStyle='#EF4444'; ctx.beginPath(); ctx.moveTo(0,-20*s); ctx.lineTo(4*s,-9*s); ctx.lineTo(0,-12*s); ctx.lineTo(-4*s,-9*s); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#2563EB'; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(4*s,-9*s); ctx.lineTo(0,-6*s); ctx.lineTo(-4*s,-9*s); ctx.closePath(); ctx.fill();
    // 표정
    ctx.fillStyle='#143C2A'; ctx.beginPath(); ctx.arc(-6*s,-11*s,2.2*s,0,7); ctx.arc(6*s,-11*s,2.2*s,0,7); ctx.fill();
    ctx.strokeStyle='#143C2A'; ctx.lineWidth=2*s; ctx.beginPath(); ctx.arc(0,-8*s,4*s,0.12*Math.PI,0.88*Math.PI); ctx.stroke();
    // 가슴의 위치 마크
    ctx.fillStyle='#FFFFFF'; ctx.font='900 '+Math.round(9*s)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('G',0,9*s);
    ctx.restore();
  };
  // 배경 이미지를 화면 크기에 맞춰 오프스크린에 1회만 리샘플 → 매 프레임은 1:1 블릿(저사양 끊김·떨림 방지)
  const bgCanvas=(idx)=>{ const img=runBgImgs[idx]; if(!img||!img.complete||!img.naturalWidth) return null;
    if(!st.bgCache) st.bgCache=[];
    if(st.bgCache[idx]) return st.bgCache[idx];
    const oc=document.createElement('canvas'); oc.width=st.W; oc.height=st.H;
    const o=oc.getContext('2d'); const iw=img.naturalWidth, ih=img.naturalHeight, sc=Math.max(oc.width/iw,oc.height/ih), sw=oc.width/sc, sh=oc.height/sc;
    o.drawImage(img,(iw-sw)/2,(ih-sh)/2,sw,sh,0,0,oc.width,oc.height);
    st.bgCache[idx]=oc; return oc; };
  const drawCoverImage=(idx,alpha)=>{ const oc=bgCanvas(idx); if(!oc) return false;
    if(alpha>=1){ ctx.drawImage(oc,0,0); }
    else { ctx.save(); ctx.globalAlpha=alpha; ctx.drawImage(oc,0,0); ctx.restore(); }
    return true; };
  const drawSceneLabel=(label,alpha)=>{
    if(alpha<=0) return; const W=st.W,k=Math.max(0.7,W/440);
    ctx.save(); ctx.globalAlpha=alpha; const txt='🗺️ '+label;
    ctx.font='900 '+Math.round(14*k)+'px sans-serif'; const w=ctx.measureText(txt).width+22*k, x=W/2-w/2, y=8*k;
    ctx.fillStyle='rgba(8,37,28,.58)'; roundRect(ctx,x,y,w,24*k,12*k); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.28)'; ctx.lineWidth=1*k; roundRect(ctx,x,y,w,24*k,12*k); ctx.stroke();
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(txt,W/2,y+12*k); ctx.restore();
  };
  // ── 우리나라 주요 도시 풍경(원경 스카이라인, 거리마다 순환) ──
  const CITY=['서울','부산','인천','대전','경주','제주'], CITYN=CITY.length;
  const drawCity=(idx,alpha)=>{ if(alpha<=0) return; const W=st.W,hz=st.hz,k=Math.max(0.6,W/440);
    ctx.save(); ctx.globalAlpha=alpha;
    const base='#95ACC8', dark='#7E97B7', acc='#6C88AA', win='rgba(255,243,185,.45)';
    const bld=(xf,w,h,c)=>{ ctx.fillStyle=c||base; ctx.fillRect(W*xf,hz-h*k,w*k,h*k);
      ctx.fillStyle=win; for(let yy=8;yy<h-6;yy+=13) for(let xx=4;xx<w-4;xx+=9) if((xx+yy)%2===0) ctx.fillRect(W*xf+xx*k,hz-(h-yy)*k,2*k,3*k); };
    if(idx===0){ // 서울: 빌딩 + N서울타워 + 롯데월드타워
      bld(0.03,20,46,dark); bld(0.10,24,66); bld(0.18,18,50,dark); bld(0.25,22,42);
      bld(0.72,20,58); bld(0.80,26,78,dark); bld(0.88,18,50);
      ctx.fillStyle=dark; ctx.beginPath(); ctx.ellipse(W*0.37,hz,48*k,18*k,0,Math.PI,0); ctx.fill();
      ctx.fillStyle=acc; ctx.fillRect(W*0.365,hz-58*k,7*k,40*k);
      ctx.beginPath(); ctx.moveTo(W*0.352,hz-58*k); ctx.lineTo(W*0.40,hz-58*k); ctx.lineTo(W*0.39,hz-72*k); ctx.lineTo(W*0.362,hz-72*k); ctx.closePath(); ctx.fill();
      ctx.fillRect(W*0.379,hz-96*k,1.8*k,24*k);
      ctx.fillStyle=acc; ctx.beginPath(); ctx.moveTo(W*0.60,hz); ctx.lineTo(W*0.609,hz-152*k); ctx.lineTo(W*0.621,hz-162*k); ctx.lineTo(W*0.633,hz-152*k); ctx.lineTo(W*0.642,hz); ctx.closePath(); ctx.fill();
    } else if(idx===1){ // 부산: 해운대 고층 + 광안대교 + 바다
      bld(0.60,16,92,dark); bld(0.66,14,112); bld(0.72,16,98,dark); bld(0.79,14,122); bld(0.86,16,90);
      const by=hz-30*k, p1=W*0.05,p3=W*0.42,p2=(p1+p3)/2;
      ctx.strokeStyle=acc; ctx.lineWidth=3*k; ctx.beginPath(); ctx.moveTo(p1,by); ctx.lineTo(p3,by); ctx.stroke();
      [p2-W*0.085,p2+W*0.085].forEach(px=>{ ctx.fillStyle=acc; ctx.fillRect(px-2*k,by-46*k,4*k,46*k); });
      ctx.beginPath(); ctx.moveTo(p1,by); ctx.quadraticCurveTo(p2,by-46*k,p3,by); ctx.stroke();
      ctx.fillStyle='rgba(120,180,230,.5)'; ctx.fillRect(0,hz-5*k,W*0.5,5*k);
    } else if(idx===2){ // 인천: 인천대교(사장교)
      bld(0.04,18,48,dark); bld(0.11,20,60); bld(0.84,18,54); bld(0.91,16,44,dark);
      const by=hz-22*k, px=W*0.5; ctx.strokeStyle=acc; ctx.lineWidth=3*k;
      ctx.beginPath(); ctx.moveTo(W*0.22,by); ctx.lineTo(W*0.78,by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px,by); ctx.lineTo(px,by-74*k); ctx.stroke();
      ctx.lineWidth=1.4*k; for(let i=1;i<=4;i++){ ctx.beginPath(); ctx.moveTo(px,by-74*k); ctx.lineTo(px-i*W*0.055,by); ctx.moveTo(px,by-74*k); ctx.lineTo(px+i*W*0.055,by); ctx.stroke(); }
    } else if(idx===3){ // 대전: 엑스포 한빛탑
      bld(0.09,18,42,dark); bld(0.16,16,54); bld(0.78,18,50); bld(0.86,16,42,dark);
      ctx.fillStyle=acc; ctx.beginPath(); ctx.moveTo(W*0.49,hz); ctx.lineTo(W*0.503,hz-122*k); ctx.lineTo(W*0.517,hz-122*k); ctx.lineTo(W*0.53,hz); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(W*0.51,hz-120*k,12*k,7*k,0,0,7); ctx.fill();
      ctx.fillRect(W*0.508,hz-152*k,2*k,30*k);
    } else if(idx===4){ // 경주: 다보탑 + 한옥 + 고분
      const stone='#A99C86', roof='#8C7B63'; let sw=42;
      [[42,24],[32,18],[22,13],[13,9]].forEach((tier,i)=>{ const w=tier[0],h=tier[1], yy=hz-(i*20)*k;
        ctx.fillStyle=stone; ctx.fillRect(W*0.5-w/2*k,yy-h*k,w*k,h*k);
        ctx.fillStyle=roof; ctx.beginPath(); ctx.moveTo(W*0.5-(w/2+5)*k,yy-h*k); ctx.lineTo(W*0.5+(w/2+5)*k,yy-h*k); ctx.lineTo(W*0.5,yy-(h+11)*k); ctx.closePath(); ctx.fill(); });
      ctx.fillStyle=roof; ctx.beginPath(); ctx.moveTo(W*0.10,hz); ctx.quadraticCurveTo(W*0.18,hz-36*k,W*0.26,hz); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#8FB07A'; ctx.beginPath(); ctx.ellipse(W*0.82,hz,42*k,28*k,0,Math.PI,0); ctx.fill();
    } else { // 제주: 한라산 + 야자수
      ctx.fillStyle='#7FA9A0'; ctx.beginPath(); ctx.moveTo(W*0.18,hz); ctx.quadraticCurveTo(W*0.5,hz-150*k,W*0.82,hz); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.6)'; ctx.beginPath(); ctx.moveTo(W*0.45,hz-116*k); ctx.lineTo(W*0.55,hz-116*k); ctx.lineTo(W*0.5,hz-150*k); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#6E5638'; ctx.lineWidth=4*k; ctx.beginPath(); ctx.moveTo(W*0.12,hz); ctx.quadraticCurveTo(W*0.10,hz-30*k,W*0.135,hz-46*k); ctx.stroke();
      ctx.fillStyle='#4FA63E'; for(let a=0;a<5;a++){ const ang=-Math.PI/2+(a-2)*0.55; ctx.beginPath(); ctx.moveTo(W*0.135,hz-46*k); ctx.lineTo(W*0.135+Math.cos(ang)*24*k,hz-46*k+Math.sin(ang)*15*k); ctx.lineTo(W*0.135+Math.cos(ang)*21*k,hz-46*k+Math.sin(ang)*9*k); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
  };
  const cityLabel=(idx,alpha)=>{ if(alpha<=0) return; const W=st.W,k=Math.max(0.7,W/440);
    ctx.save(); ctx.globalAlpha=alpha; const txt='🏙️ '+CITY[idx]+' 풍경';
    ctx.font='800 '+Math.round(14*k)+'px sans-serif'; const w=ctx.measureText(txt).width+20*k, x=W/2-w/2, y=8*k;
    ctx.fillStyle='rgba(20,42,72,.5)'; roundRect(ctx,x,y,w,23*k,12*k); ctx.fill();
    ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(txt,W/2,y+12*k); ctx.restore(); };
  const draw=()=>{
    const W=st.W,H=st.H,hz=st.hz; ctx.clearRect(0,0,W,H);
    const bgSeg=820, bgCp=(st.dist%bgSeg)/bgSeg, bgCur=Math.floor(st.dist/bgSeg)%RUNNER_SCENES.length, bgNxt=(bgCur+1)%RUNNER_SCENES.length;
    const bgFade = bgCp>0.86 ? (bgCp-0.86)/0.14 : 0;
    if(st.W && !st.bgCache?.[bgNxt]) bgCanvas(bgNxt);
    // 현재 장면을 항상 '불투명 베이스'로 깔고, 다음 장면을 위에 페이드 인
    // (반투명 두 장을 겹치면 검은 배경이 비쳐 전환 때 화면이 번쩍/깨져 보임)
    let imageSceneReady = drawCoverImage(bgCur,1);
    if(!imageSceneReady) imageSceneReady = drawCoverImage(bgNxt,1);
    else if(bgFade>0) drawCoverImage(bgNxt,bgFade);
    if(imageSceneReady){
      ctx.fillStyle=st.gTint; ctx.fillRect(0,hz,W,H-hz);
      drawSceneLabel(RUNNER_SCENES[bgFade<0.5?bgCur:bgNxt].label,1);
    } else {
    // 하늘 + 해 글로우
    ctx.fillStyle=st.gSky; ctx.fillRect(0,0,W,hz+1);
    const sx=W*0.80, sy=hz*0.40, sr=Math.min(22,W*0.06);
    let glow=ctx.createRadialGradient(sx,sy,sr*0.4,sx,sy,sr*4.2); glow.addColorStop(0,'rgba(255,236,150,.75)'); glow.addColorStop(1,'rgba(255,236,150,0)');
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(sx,sy,sr*4.2,0,7); ctx.fill();
    ctx.fillStyle='#FFE585'; ctx.beginPath(); ctx.arc(sx,sy,sr,0,7); ctx.fill();
    // 구름(흐름)
    const cd=(st.dist*0.5);
    [[W*0.18,hz*0.30,1],[W*0.58,hz*0.20,.8],[W*0.92,hz*0.52,.7]].forEach(([cx0,cy,sc],i)=>{
      let cx=((cx0 - cd*(0.25+0.15*i)) % (W+180)); if(cx<-90) cx+=W+180;
      ctx.fillStyle='rgba(255,255,255,.92)'; ctx.beginPath();
      ctx.ellipse(cx,cy,30*sc,12*sc,0,0,7); ctx.ellipse(cx+22*sc,cy-6*sc,20*sc,11*sc,0,0,7); ctx.ellipse(cx-20*sc,cy+2*sc,17*sc,9*sc,0,0,7); ctx.fill(); });
    // 원경 산(2겹)
    const hill=(amp,col,ph)=>{ ctx.fillStyle=col; ctx.beginPath(); ctx.moveTo(0,hz);
      for(let x=0;x<=W;x+=18){ ctx.lineTo(x, hz-amp*(0.45+0.55*Math.sin(x*0.013+ph))); } ctx.lineTo(W,hz); ctx.closePath(); ctx.fill(); };
    hill(hz*0.40,'#AAD79E',0.6);                                   // 원경 야산(도시 뒤 배경)
    // 우리나라 주요 도시 풍경(거리마다 순환·크로스페이드)
    const seg=700, cp=(st.dist%seg)/seg, cur=Math.floor(st.dist/seg)%CITYN, nxt=(cur+1)%CITYN;
    const aN = cp>0.86 ? (cp-0.86)/0.14 : 0;
    drawCity(cur,1-aN); drawCity(nxt,aN); cityLabel(aN<0.5?cur:nxt, 1);
    }
    // 잔디
    if(!imageSceneReady){ ctx.fillStyle=st.gGrass; ctx.fillRect(0,hz,W,H-hz); }
    // 잔디 속도 줄무늬
    const NB=12;
    for(let k=0;k<NB;k++){ if(((k+Math.floor(st.scroll*NB))%2)) continue; const t0=k/NB,t1=(k+1)/NB;
      ctx.fillStyle='rgba(85,165,65,.22)'; ctx.fillRect(0,projY(t0),W,Math.max(1,projY(t1)-projY(t0))); }
    // 도로(가운데 밝은 그라데이션)
    const rh0=roadHalf(0), rh1=roadHalf(1);
    ctx.fillStyle=st.gRoad; ctx.beginPath(); ctx.moveTo(W/2-rh0,hz); ctx.lineTo(W/2+rh0,hz); ctx.lineTo(W/2+rh1,H); ctx.lineTo(W/2-rh1,H); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.08)'; ctx.beginPath();
    ctx.moveTo(W/2-rh0*.28,hz); ctx.lineTo(W/2+rh0*.28,hz); ctx.lineTo(W/2+rh1*.42,H); ctx.lineTo(W/2-rh1*.42,H); ctx.closePath(); ctx.fill();
    const speedN=9;
    for(let k=0;k<speedN;k++){
      const t=((k/speedN)+(st.scroll*0.7))%1; if(t<0.08) continue;
      const y=projY(t), len=(16+34*t)*scaleAt(t), a=.08+.18*t;
      ctx.strokeStyle='rgba(255,255,255,'+a+')'; ctx.lineWidth=Math.max(1,2.4*scaleAt(t));
      [-0.72,0.72].forEach(side=>{ const x=W/2+side*roadHalf(t); ctx.beginPath(); ctx.moveTo(x,y-len); ctx.lineTo(x,y+len*.25); ctx.stroke(); });
    }
    // 럼블 스트립
    const N=16;
    for(let k=0;k<N;k++){ if(((k+Math.floor(st.scroll*N))%2)) continue; const t0=k/N,t1=(k+1)/N;
      [-1,1].forEach(sgn=>{ ctx.fillStyle='#E04B3C';
        const xa=W/2+sgn*roadHalf(t0), xb=W/2+sgn*roadHalf(t1), wa=6*scaleAt(t0), wb=6*scaleAt(t1);
        ctx.beginPath(); ctx.moveTo(xa-sgn*wa,projY(t0)); ctx.lineTo(xa+sgn*wa,projY(t0)); ctx.lineTo(xb+sgn*wb,projY(t1)); ctx.lineTo(xb-sgn*wb,projY(t1)); ctx.closePath(); ctx.fill(); }); }
    // 차선 점선
    [0.5,1.5].forEach(b=>{ for(let k=0;k<N;k++){ if(((k+Math.floor(st.scroll*N))%2)) continue;
      const t0=k/N,t1=(k+0.62)/N; const x0=W/2+(b-1)*(roadHalf(t0)*2/3), x1=W/2+(b-1)*(roadHalf(t1)*2/3);
      const w0=Math.max(1,2*scaleAt(t0)), w1=Math.max(1.4,2*scaleAt(t1));
      ctx.fillStyle='rgba(255,255,255,.92)'; ctx.beginPath();
      ctx.moveTo(x0-w0,projY(t0)); ctx.lineTo(x0+w0,projY(t0)); ctx.lineTo(x1+w1,projY(t1)); ctx.lineTo(x1-w1,projY(t1)); ctx.closePath(); ctx.fill(); } });
    // 가로수(원근 스크롤)
    const M=5, frac=(st.dist*0.05)%1, tts=[];
    for(let k=0;k<M;k++) tts.push(((k/M)+frac)%1);
    tts.sort((a,b)=>a-b).forEach(tt=>{ if(tt>0.05){ drawTree(-1,tt); drawTree(1,tt); } });
    // 장애물(깊은 것부터)
    st.items.filter(it=>!it.dead).sort((a,b)=>a.t-b.t).forEach(it=>drawObstacle(it.lane,it.t));
    // 갈림길 표지판(정답 비노출 — 둘 다 초록 / 위쪽 상단 박스에 문제·선지)
    if(st.gate){ const g=st.gate;
      if(g.okLane<g.badLane){ drawSign(g.okName,g.okLane,g.t); drawSign(g.badName,g.badLane,g.t); }
      else { drawSign(g.badName,g.badLane,g.t); drawSign(g.okName,g.okLane,g.t); } }
    // 캐릭터
    drawChar();
  };
  // 배경 오프스크린 미리 굽기(장면 전환 때 첫 프레임 끊김 방지) — 로드된 건 즉시, 나머지는 로드되면
  runBgImgs.forEach((img,i)=>{ const warm=()=>{ if(st.bgCache) st.bgCache[i]=null; if(st.W) bgCanvas(i); };
    if(img.complete && img.naturalWidth) warm(); else img.addEventListener('load', warm); });
  G.arcade.raf=requestAnimationFrame(loop);
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

function endGame(){
  if(!Number.isFinite(G.score)) G.score=0;   // 점수 손상 시 코인/XP NaN 전파 차단
  stopArcade();
  stopTimer();
  clearMapTap();
  $('map-svg').onclick=null;
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='');
  show('screen-result');
  bumpStreak();
  const detail=$('result-detail');
  $('name-entry').classList.add('hidden');

  if(G.battle){
    const b=G.battle;
    const w = b.scores[0]===b.scores[1] ? -1 : (b.scores[0]>b.scores[1]?0:1);
    const gap = Math.abs(b.scores[0]-b.scores[1]);
    $('result-title').textContent='⚔️ 배틀 결과';
    $('result-main').textContent = w<0 ? '무승부!' : `🏆 ${b.names[w]} 승리!`;
    const tag = w<0 ? '다시 붙어야겠죠?' : gap<150 ? '진땀나는 접전이었어요!' : '압도적인 승리!';
    detail.innerHTML=`${tag}<table class="vs-table">
      <tr><td><b>${b.names[0]}</b></td><td>${b.scores[0]}점</td><td>정답 ${b.correct[0]}/${Math.ceil(G.queue.length/2)}</td></tr>
      <tr><td><b>${b.names[1]}</b></td><td>${b.scores[1]}점</td><td>정답 ${b.correct[1]}/${Math.floor(G.queue.length/2)}</td></tr></table>`;
    xp+=Math.round((Math.max(0,b.scores[0])+Math.max(0,b.scores[1]))/20);
    const earned=Math.max(0, Math.floor((Math.max(0,b.scores[0])+Math.max(0,b.scores[1]))/320));
    coins+=earned; store.save('geo_coins',coins); updateGachaUI();
    detail.innerHTML+=`<div style="margin-top:6px">🪙 카드 코인 +${earned} (보유 ${coins})</div>`;
    confetti(document.querySelector('.result-card'));
  } else {
    const answered = G.idx;
    const acc = answered? Math.round(G.correctCnt/answered*100):0;
    // 일일 도전 '연습'(오늘 이미 도전함)은 문제가 고정이라 보상 없음(파밍 방지)
    const dailyPractice = G.mode==='daily' && store.load('geo_daily_done','')===dayKey();
    const earned = dailyPractice ? 0 : Math.max(0, Math.floor(G.score/200));   // 코인 적립 둔화(/200·바닥0)
    coins+=earned; store.save('geo_coins',coins); updateGachaUI();
    if(G.mode==='boss'){
      const need=Math.ceil(G.queue.length*0.7), win=G.correctCnt>=need;
      const first = win && !titles[G.bossRegion];
      if(win){ titles[G.bossRegion]=true; store.save('geo_titles',titles); }
      $('result-title').textContent = win ? '👹 보스 격파!' : '👹 보스가 버텼습니다';
      $('result-main').textContent = `${G.correctCnt} / ${G.queue.length} 격파`;
      detail.innerHTML =
        (win ? `🏆 칭호 <b style="color:var(--gold)">${bossTitle(G.bossRegion)}</b> ${first?'획득!':'유지'}`
             : `${need}타 이상 명중하면 격파! 한 번 더 도전하세요.`)+
        `<br>🪙 카드 코인 +${earned} (보유 ${coins})`+
        `<br><span style="font-size:.86em">${resultComment(acc)}</span>`;
      xp+=Math.max(0, Math.round(G.score/10));
      if(win) confetti(document.querySelector('.result-card'));
    } else if(G.mode==='streak'){
      const streak=G.correctCnt;
      const prevBest=store.load('geo_beststreak',0);
      const best=Math.max(streak, prevBest);
      store.save('geo_beststreak', best);
      const newRec = streak>prevBest && streak>0;
      $('result-title').textContent = newRec ? '🔥 최고 연승 기록!' : '🔥 연승 종료!';
      $('result-main').textContent = `${streak}연승`;
      detail.innerHTML=`점수 <b>${G.score}</b> · 최고 기록 <b>${best}</b>연승`+
        (earned?`<br>🪙 카드 코인 <b style="color:var(--gold)">+${earned}</b> (보유 ${coins})`:'')+
        `<br><span style="font-size:.86em">${streakComment(streak)}</span>`;
      xp+=Math.max(0, Math.round(G.score/10));
      if(streak>=10||newRec) confetti(document.querySelector('.result-card'));
      if(G.score>0){
        $('name-entry').classList.remove('hidden');
        $('player-name').value = currentUser ? currentUser.email.split('@')[0] : store.load('geo_lastname','');
      }
    } else if(G.mode==='bingo'){
      const done=G.bingo.cells.filter(c=>c.done).length;
      const lines=G.bingo.lineKeys.size, over=G.bingo.wrong>=2, blackout=done===25;
      if(blackout) store.save('geo_bingo_black', true);
      $('result-title').textContent = blackout ? '🧩 빙고 블랙아웃!' : over ? '🧩 게임 오버 (2회 오답)' : '🧩 빙고 게임 결과';
      $('result-main').textContent = `${done}/25칸 · 빙고 ${lines}줄 · ${G.score}점`;
      detail.innerHTML=`정답 ${G.correctCnt} / ${answered}`+
        (earned?`<br>🪙 카드 코인 <b style="color:var(--gold)">+${earned}</b> (보유 ${coins})`:'')+
        `<br><span style="font-size:.86em">${over?'2회 오답으로 종료됐어요. 다시 도전해 보세요!':resultComment(acc)}</span>`;
      xp+=Math.max(0, Math.round(G.score/10));
      if(blackout||lines>=3) confetti(document.querySelector('.result-card'));
      if(G.score>0){
        $('name-entry').classList.remove('hidden');
        $('player-name').value = currentUser ? currentUser.email.split('@')[0] : store.load('geo_lastname','');
      }
    } else if(G.mode==='daily'){
      const today=dayKey(), first = store.load('geo_daily_done','')!==today;
      $('result-title').textContent='🔁 오늘의 도전 완료!';
      $('result-main').textContent=`${G.score}점 · 정답 ${G.correctCnt}/${answered}`;
      detail.innerHTML=`정답률 ${acc}%`+
        (earned?`<br>🪙 카드 코인 <b style="color:var(--gold)">+${earned}</b> (보유 ${coins})`:'')+
        `<br><span style="font-size:.86em">${first?'오늘 기록이 일일 랭킹에 등록됐어요! 🏆':'오늘은 이미 도전했어요 — 연습이라 보상·랭킹은 없어요.'}</span>`;
      if(first) xp+=Math.max(0, Math.round(G.score/10));   // 연습 반복으로 XP 파밍 방지
      if(first && acc>=70) confetti(document.querySelector('.result-card'));
      if(first){
        store.save('geo_daily_done', today); store.save('geo_daily_score', G.score);
        if(G.score>0){
          const nm = currentUser ? currentUser.email.split('@')[0] : (store.load('geo_lastname','')||'무명');
          postDailyScore(today, nm, G.score);
        }
      }
    } else {
      $('result-title').textContent=MODE_INFO[G.mode].title+' 결과';
      $('result-main').textContent=G.score+'점';
      detail.innerHTML=`정답 ${G.correctCnt} / ${answered} (정답률 ${acc}%) · 최대 콤보 ${G.maxCombo}🔥`+
        (earned?`<br>🪙 카드 코인 <b style="color:var(--gold)">+${earned}</b> (보유 ${coins}${coins>=DRAW_COST?' — 뽑기 가능!':''})`:'')+
        `<br><span style="font-size:.86em">${resultComment(acc)}</span>`;
      xp+=Math.max(0, Math.round(G.score/10));
      if(acc>=70 && answered>=5) confetti(document.querySelector('.result-card'));
      if(G.score>0 && G.mode!=='wanted'){   // 수배 복습은 개인 연습 — 공개 랭킹 등록 생략
        $('name-entry').classList.remove('hidden');
        $('player-name').value = currentUser ? currentUser.email.split('@')[0] : store.load('geo_lastname','');
      }
    }
  }
  store.save('geo_xp',xp);
  store.save('geo_maxcombo', Math.max(store.load('geo_maxcombo',0), G.maxCombo||0));
  checkAchievements();
  scheduleSync();
}

$('btn-save-score').onclick=()=>{
  const name=($('player-name').value.trim()||'무명').slice(0,30);
  const mode=G.mode, score=G.score;
  store.save('geo_lastname',name);
  const list=board[mode]||(board[mode]=[]);
  list.push({name,score,date:new Date().toISOString().slice(0,10)});
  list.sort((a,b)=>b.score-a.score); board[mode]=list.slice(0,10);
  store.save('geo_board',board);                 // 로컬 백업(서버 불가 시 fallback)
  $('name-entry').classList.add('hidden');
  // 서버 공유 명예의 전당 등록 후 갱신
  postServerScore(mode, name, score).then(res=>{ if(res) fetchServerBoard().then(b=>{ if(b) renderHomeBoard(); }); });
};
$('btn-retry').onclick=()=>startGame(G.mode);
$('btn-home').onclick=()=>{ initHome(); show('screen-home'); resetHomeTab(); };
$('btn-quit').onclick=()=>{ stopArcade(); stopTimer(); clearMapTap(); $('map-svg').onclick=null;
  ['hud-qnum','hud-combo','hud-score'].forEach(id=>$(id).parentElement.style.visibility='');
  initHome(); show('screen-home'); resetHomeTab();
};

// ---------- 게임 모드 캐러셀: 화살표·드래그·휠 가로 스크롤 ----------
(function initCarousel(){
  const car=$('mode-carousel'); if(!car) return;
  const prev=$('car-prev'), next=$('car-next');
  const step=()=>car.querySelector('.mode-card').offsetWidth+11;
  const updateArrows=()=>{
    if(!prev||!next) return;
    prev.disabled=car.scrollLeft<=2;
    next.disabled=car.scrollLeft>=car.scrollWidth-car.clientWidth-2;
  };
  prev&&(prev.onclick=()=>{ car.scrollBy({left:-step()*1.2, behavior:'smooth'}); });
  next&&(next.onclick=()=>{ car.scrollBy({left:step()*1.2, behavior:'smooth'}); });
  car.addEventListener('scroll', updateArrows, {passive:true});
  // 마우스 드래그(데스크톱)
  let down=false, sx=0, sl=0, moved=false;
  car.addEventListener('mousedown',e=>{ down=true; moved=false; sx=e.pageX; sl=car.scrollLeft; car.classList.add('dragging'); });
  window.addEventListener('mousemove',e=>{ if(!down) return; const dx=e.pageX-sx; if(Math.abs(dx)>4) moved=true; car.scrollLeft=sl-dx; });
  window.addEventListener('mouseup',()=>{ if(down){ down=false; car.classList.remove('dragging'); } });
  // 드래그 직후 카드 클릭 방지
  car.addEventListener('click',e=>{ if(moved){ e.preventDefault(); e.stopPropagation(); moved=false; } }, true);
  // 세로 휠 → 가로 스크롤
  car.addEventListener('wheel',e=>{
    if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ car.scrollLeft+=e.deltaY; e.preventDefault(); }
  }, {passive:false});
  setTimeout(updateArrows, 100);
})();

// ---------- 카드 뽑기/컬렉션 이벤트 ----------
$('btn-draw').onclick=openGacha;
$('btn-draw-again').onclick=openGacha;
$('btn-draw10')?.addEventListener('click', ()=>openGachaMulti(10));
$('btn-draw10-again')?.addEventListener('click', ()=>openGachaMulti(10));
$('btn-enhance-all')?.addEventListener('click', ()=>{
  const n=enhanceableCount();
  if(!n) return;
  if(!confirm(`강화 가능한 카드 ${n}장을 한꺼번에 강화할까요?\n(같은 카드 ${ENHANCE_NEED}장당 1단계 상승)`)) return;
  const done=doEnhanceAll();
  renderCollection(_collFilter);
  alert(done? `⚡ ${done}번 강화 완료!` : '강화할 카드가 없어요');
});
$('btn-gacha-close').onclick=()=>{
  $('gacha-modal').classList.add('hidden');
  $('btn-draw-again').classList.remove('hidden');
  if($('screen-cards').classList.contains('active')) openCollection(); else initHome();
};
$('btn-collection').onclick=openCollection;
$('btn-explore').onclick=()=>startGame('explore');
$('btn-cards-back').onclick=()=>{ initHome(); show('screen-home'); };

// ---------- Firebase Auth: account-chip 로그아웃 이미 renderAccount에서 처리됨 ----------
// (로그인은 index.html에서 완료 후 game.html로 리다이렉트)

// ---------- 하단 탭 네비게이션 ----------
document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.tab;
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+t));
  document.querySelectorAll('.tab-btn').forEach(x=>x.classList.toggle('active', x===b));
  try{ window.scrollTo(0,0); }catch(e){}
}));
// 홈 복귀 시 항상 '플레이' 탭으로
function resetHomeTab(){
  const pb=document.querySelector('.tab-btn[data-tab="play"]');
  if(pb) pb.click();
}

// ============================================================
// Firestore 게임 데이터 로더
// ============================================================
async function loadGameData() {
  const overlay = $('loading-overlay');
  const loadMsg = $('loading-msg');
  const loadBar = $('loading-bar');
  const progress = (pct, msg) => {
    if (loadBar) loadBar.style.width = pct + '%';
    if (loadMsg) loadMsg.textContent = msg;
  };
  try {
    progress(10, '개념 퀴즈 불러오는 중...');
    const mcqSnap = await getDocs(collection(db, 'gameData/mcq/items'));
    if (!mcqSnap.empty) {
      const arr = [];
      mcqSnap.forEach(d => {
        const v = d.data();
        arr.push({ region: v.region||'', q: v.q||'', choices: Array.isArray(v.choices)?v.choices:[], answer: typeof v.answer==='number'?v.answer:0, exp: v.exp||'' });
      });
      if (arr.length) MCQ = arr;
    }
    progress(28, 'OX 문제 불러오는 중...');
    const oxSnap = await getDocs(collection(db, 'gameData/ox/items'));
    if (!oxSnap.empty) {
      const arr = [];
      oxSnap.forEach(d => { const v=d.data(); arr.push({ region:v.region||'', q:v.q||'', answer:!!v.answer, exp:v.exp||'' }); });
      if (arr.length) OX = arr;
    }
    progress(46, '위치 데이터 불러오는 중...');
    const locSnap = await getDocs(collection(db, 'gameData/locations/items'));
    if (!locSnap.empty) {
      const arr = [];
      locSnap.forEach(d => {
        const v = d.data();
        arr.push({ name:v.name||'', x:parseFloat(v.x)||0, y:parseFloat(v.y)||0, region:v.region||'', fact:v.fact||'', accept:Array.isArray(v.accept)?v.accept:[] });
      });
      if (arr.length) { window.LOCATIONS = arr; LOC_POOL = null; }
    }
    progress(68, '빈출 분석 불러오는 중...');
    const freqSnap = await getDoc(doc(db, 'gameData/freq'));
    if (freqSnap.exists()) {
      try { const p=JSON.parse(freqSnap.data().json||'{}'); if(Object.keys(p).length) window.FREQ=p; } catch(e){}
    }
    progress(84, '지역 메모 불러오는 중...');
    const notesSnap = await getDoc(doc(db, 'gameData/regionNotes'));
    if (notesSnap.exists()) {
      try { const p=JSON.parse(notesSnap.data().json||'{}'); if(Object.keys(p).length) window.REGION_NOTES=p; } catch(e){}
    }
    progress(90, '인구·기후·통계 보강 중...');
    // ponytail: MUNIS/CLIMATE/SIDO_STATS는 map-data.js·stats-data.js에서 const로 선언돼 있어
    // window.X = ... 로 통째로 갈아치우면 다른 곳의 맨 이름(bare) 참조에 반영 안 될 수 있음.
    // 그래서 기존 객체·배열을 그 자리에서 직접 고치는 방식으로 처리(재할당 없음).
    const popSnap = await getDoc(doc(db, 'gameData/population'));
    if (popSnap.exists()) {
      try {
        const p = JSON.parse(popSnap.data().json || '{}');
        Object.entries(p).forEach(([name, pop]) => {
          const v = parseInt(pop);
          if (MUNIS[name] && Number.isFinite(v)) MUNIS[name].pop = v;
        });
      } catch(e) {}
    }
    const climSnap = await getDocs(collection(db, 'gameData/climate/items'));
    if (!climSnap.empty) {
      const arr = [];
      climSnap.forEach(d => {
        const v = d.data();
        arr.push({
          name: v.name||'', src: v.src||'', region: v.region||'', nk: !!v.nk,
          x: (v.x==null)?null:parseFloat(v.x), y: (v.y==null)?null:parseFloat(v.y), alt: parseFloat(v.alt)||0,
          p: Array.isArray(v.p)?v.p.map(Number):[], t: Array.isArray(v.t)?v.t.map(Number):[]
        });
      });
      if (arr.length) { CLIMATE.length = 0; arr.forEach(c => CLIMATE.push(c)); }
    }
    const kosisSnap = await getDoc(doc(db, 'gameData/sidoKosis'));
    if (kosisSnap.exists()) {
      try {
        const p = JSON.parse(kosisSnap.data().json || '{}');
        SIDO_STATS.forEach(s => { const k = p[s.name]; if (k) Object.assign(s, k); });
      } catch(e) {}
    }
    progress(100, '준비 완료!');
  } catch(err) {
    console.warn('[Firestore 로딩 실패 — 로컬 데이터 사용]', err);
    progress(100, '로컬 데이터로 시작합니다.');
  }
  setTimeout(() => { if (overlay) overlay.style.display = 'none'; }, 350);
}

// ---------- 시작: Firebase Auth 확인 후 게임 진입 ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  const emailId = user.email.split('@')[0];
  const chip = $('account-chip');
  if (chip) {
    chip.textContent = `👤 ${emailId}`;
    chip.onclick = () => { if (confirm(`${emailId} 로그아웃?`)) signOut(auth).then(() => window.location.href = 'index.html'); };
  }
  // Firestore 사용자 문서 초기화 (첫 접속 시)
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) await setDoc(userRef, { email: user.email, totalScore: 0, playCount: 0, createdAt: serverTimestamp() });
  } catch(e) {}

  await loadGameData();
  buildMap();
  initMapGestures();
  initHome();
  history.pushState(null, '');
  window.addEventListener('popstate', () => {
    history.pushState(null, '');
    const active = document.querySelector('.screen.active');
    const id = active ? active.id : 'screen-home';
    if (id === 'screen-home') {
      signOut(auth).then(() => { window.location.href = 'index.html'; });
    } else if (id === 'screen-game') {
      stopArcade(); stopTimer(); clearMapTap();
      $('map-svg').onclick = null;
      ['hud-qnum','hud-combo','hud-score'].forEach(i => {
        const el = $(i); if (el && el.parentElement) el.parentElement.style.visibility = '';
      });
      initHome(); show('screen-home'); resetHomeTab();
    } else {
      initHome(); show('screen-home'); resetHomeTab();
    }
  });
  show('screen-home');
});
