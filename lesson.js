/* =====================================================================
   천일문 기본 · Unit 학습 엔진
   각 catbookptNN.html 은 window.UNIT 에 내용만 적고 이 파일을 불러옵니다.
   흐름: ① 강의 듣기 → ② 이해 확인(객관식) → ③ 마인드맵 → ④ 독해·쓰기
   (내용이 없는 단계는 자동으로 건너뜀)
   ===================================================================== */
(function () {
  'use strict';

  const U = window.UNIT;
  const CFG = window.LESSON_CONFIG || {};
  const LECTURE_DONE = CFG.lectureDoneRatio || 0.9;   // 강의를 90% 이상 실제 재생하면 완료
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const toSec = s => { if (typeof s === 'number') return s; const p = String(s).split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); };
  const fmt = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(s); };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ---------- 저장 (이 브라우저 안) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  const KEY = 'cb_u' + pad(U.id);
  const S = Object.assign({ stage: 0, quiz: { attempts: [], passed: false, cur: null, review: null }, mm: { attempts: 0, passed: false, placed: {} }, rd: { submitted: false, answers: [] } }, store.get(KEY, {}));
  /* 강의 시청 기록은 Unit과 상관없이 영상별로 저장 (두 Unit에 걸친 강의를 다시 듣지 않아도 되게) */
  const LEC = {};
  const save = () => { store.set(KEY, S); Object.keys(LEC).forEach(k => store.set('cb_v_' + k, LEC[k])); };
  let student = store.get('cb_student', '');

  /* ---------- 구글 시트로 기록 보내기 ---------- */
  const QKEY = 'cb_queue';
  function log(event, data) {
    const row = Object.assign({ clientTime: new Date().toISOString(), student, unit: 'Unit ' + pad(U.id), unitTitle: U.title, event }, data || {});
    if (!CFG.endpoint) { console.log('[기록 — 시트 주소 미설정]', row); return; }
    const q = store.get(QKEY, []); q.push(row); store.set(QKEY, q);
    flush();
  }
  let flushing = false;
  async function flush() {
    if (flushing || !CFG.endpoint) return;
    flushing = true;
    try {
      let q = store.get(QKEY, []);
      while (q.length) {
        await fetch(CFG.endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(q[0]) });
        q = store.get(QKEY, []); q.shift(); store.set(QKEY, q);
      }
    } catch (e) { /* 인터넷이 끊기면 다음에 다시 보냄 */ }
    flushing = false;
  }
  window.addEventListener('online', flush);

  /* ---------- 시청 구간 기록 (초 단위 비트맵) ---------- */
  function encodeRanges(set) {
    const a = [...set].sort((x, y) => x - y); const out = []; let s = null, p = null;
    for (const v of a) { if (s === null) { s = p = v; } else if (v === p + 1) { p = v; } else { out.push(s === p ? '' + s : s + '-' + p); s = p = v; } }
    if (s !== null) out.push(s === p ? '' + s : s + '-' + p);
    return out.join(',');
  }
  function decodeRanges(str) {
    const set = new Set(); if (!str) return set;
    str.split(',').forEach(r => { const [a, b] = r.split('-').map(Number); for (let i = a; i <= (isNaN(b) ? a : b); i++) set.add(i); });
    return set;
  }

  /* ---------- 유튜브 플레이어 ---------- */
  let ytReady = null;
  function loadYT() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(window.YT); };
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('유튜브를 불러오지 못했습니다'));
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) reject(new Error('유튜브를 불러오지 못했습니다')); }, 15000);
    });
    return ytReady;
  }

  /* 플레이어 + 0.5초마다 재생 상태를 살피는 감시자
     onTick({t, playing, rate, jumped, hidden, dt}) */
  function makePlayer(elId, videoId, onTick) {
    const api = { player: null, ready: null, timer: null };
    api.ready = loadYT().then(YT => new Promise(res => {
      api.player = new YT.Player(elId, {
        width: '100%', height: '100%', videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: () => res(api.player) }
      });
    }));
    let lastT = null, lastWall = null;
    api.start = () => {
      clearInterval(api.timer);
      api.timer = setInterval(() => {
        const p = api.player; if (!p || !p.getPlayerState) return;
        const playing = p.getPlayerState() === 1;
        const t = p.getCurrentTime() || 0;
        const rate = p.getPlaybackRate ? p.getPlaybackRate() : 1;
        const now = performance.now();
        let jumped = 0;
        if (lastT !== null && playing) {
          const expected = lastT + (now - lastWall) / 1000 * rate;
          if (Math.abs(t - expected) > 3) jumped = t - expected;
        }
        const dt = lastWall ? (now - lastWall) / 1000 : 0;
        lastT = t; lastWall = now;
        onTick({ t, playing, rate, jumped, hidden: document.hidden, dt });
      }, 500);
    };
    api.reset = () => { lastT = null; lastWall = null; };
    return api;
  }

  /* ---------- 단계 구성 ---------- */
  const STAGES = [{ id: 'lec', name: '강의 듣기' }];
  if (U.quiz && U.quiz.questions && U.quiz.questions.length) STAGES.push({ id: 'quiz', name: '이해 확인' });
  if (U.mindmap) STAGES.push({ id: 'mm', name: '마인드맵' });
  if (U.reading) STAGES.push({ id: 'rd', name: '독해·쓰기' });

  const required = U.lectures.filter(l => !l.optional);
  const lecState = key => LEC[key] || (LEC[key] = Object.assign({ ranges: '', dur: 0, pos: 0, done: false, seeks: 0, maxRate: 1, hidden: 0 }, store.get('cb_v_' + key, {})));
  const lecCoverage = key => { const st = lecState(key); if (!st.dur) return 0; return Math.min(1, decodeRanges(st.ranges).size / Math.floor(st.dur)); };
  const stageDone = id => {
    if (id === 'lec') return required.every(l => lecState(l.id).done);
    if (id === 'quiz') return S.quiz.passed;
    if (id === 'mm') return S.mm.passed;
    if (id === 'rd') return S.rd.submitted;
  };
  const unlockedUpTo = () => { let i = 0; while (i < STAGES.length && stageDone(STAGES[i].id)) i++; return i; };
  const allDone = () => STAGES.every(s => stageDone(s.id));

  /* ---------- 스타일 ---------- */
  const css = `
  :root{--bg:#f1f5f9;--card:#fff;--ink:#0f172a;--ink2:#334155;--muted:#64748b;--line:#e2e8f0;--brand:#0284c7;--brand2:#0369a1;--soft:#e0f2fe;--ok:#16a34a;--oksoft:#dcfce7;--bad:#dc2626;--badsoft:#fee2e2;--warn:#d97706;--warnsoft:#fef3c7}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:'Noto Sans KR',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;line-height:1.6}
  .wrap{max-width:960px;margin:0 auto;padding:20px 16px 80px}
  .top{display:flex;align-items:center;gap:10px;margin-bottom:14px;font-size:14px}
  .top a{color:var(--brand2);text-decoration:none;font-weight:700}
  .top .who{margin-left:auto;color:var(--muted)} .top .who button{border:0;background:none;color:var(--brand2);cursor:pointer;font:inherit;text-decoration:underline}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 6px 18px -10px rgba(15,23,42,.18);margin-bottom:16px}
  .head .badge{display:inline-block;font-size:12px;font-weight:800;color:var(--brand2);background:var(--soft);border-radius:6px;padding:2px 8px;margin-right:6px}
  .head h1{font-size:24px;margin:8px 0 2px;font-weight:900;letter-spacing:-.01em}
  .head p{margin:0;color:var(--muted);font-size:14px}
  .steps{display:flex;gap:6px;margin-top:18px;flex-wrap:wrap}
  .step{flex:1;min-width:120px;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:#f8fafc;color:var(--muted);font-size:14px;font-weight:700;cursor:default}
  .step .n{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#e2e8f0;color:#475569;font-size:12px;flex:none}
  .step.on{border-color:var(--brand);background:var(--soft);color:var(--brand2)} .step.on .n{background:var(--brand);color:#fff}
  .step.done{color:var(--ok);cursor:pointer} .step.done .n{background:var(--ok);color:#fff}
  .step.lock{opacity:.55}
  h2.sec{font-size:19px;margin:0 0 4px;font-weight:900} p.sub{margin:0 0 16px;color:var(--muted);font-size:14px}
  .player{position:relative;width:100%;aspect-ratio:16/9;background:#0f172a;border-radius:12px;overflow:hidden}
  .player>div,.player iframe{position:absolute;inset:0;width:100%;height:100%}
  .player .msg{position:absolute;inset:0;display:grid;place-items:center;color:#cbd5e1;font-size:14px;text-align:center;padding:20px}
  .lecs{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
  .lec{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer;background:#fff;text-align:left;width:100%;font:inherit;color:inherit}
  .lec:hover{border-color:#7dd3fc} .lec.cur{border-color:var(--brand);background:var(--soft)}
  .lec .no{font-weight:900;color:var(--brand2);font-size:13px;width:44px;flex:none}
  .lec .tt{flex:1;min-width:0} .lec .tt b{display:block;font-size:14px;font-weight:700} .lec .tt small{color:var(--muted);font-size:12px}
  .lec .pct{font-size:12px;color:var(--muted);width:64px;text-align:right;flex:none}
  .lec.done .pct{color:var(--ok);font-weight:800}
  .bar{height:5px;background:#e2e8f0;border-radius:3px;margin-top:6px;overflow:hidden} .bar i{display:block;height:100%;background:var(--brand);width:0}
  .lec.done .bar i{background:var(--ok)}
  .tag{font-size:11px;font-weight:700;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:1px}
  .tag.opt{background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:10px;padding:12px 22px;font:inherit;font-weight:800;font-size:15px;cursor:pointer;background:var(--brand);color:#fff}
  .btn:hover{background:var(--brand2)} .btn:disabled{background:#94a3b8;cursor:not-allowed}
  .btn.ghost{background:#fff;color:var(--brand2);border:1px solid #bae6fd} .btn.ghost:hover{background:var(--soft)}
  .btn.sm{padding:7px 12px;font-size:13px;border-radius:8px}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:18px} .row .grow{flex:1}
  .note{font-size:13px;color:var(--muted)}
  .q{border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;background:#fff}
  .q .qt{font-weight:700;margin-bottom:10px;white-space:pre-line} .q .qt .qn{color:var(--brand2);font-weight:900;margin-right:6px}
  .q .box{background:#f8fafc;border-left:4px solid #cbd5e1;padding:10px 14px;margin:0 0 12px;white-space:pre-line;font-size:14px;color:var(--ink2)}
  .opt{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border:1px solid var(--line);border-radius:8px;margin-top:6px;cursor:pointer;font-size:14.5px}
  .opt:hover{background:#f8fafc} .opt input{margin-top:5px} .opt.sel{border-color:var(--brand);background:var(--soft)}
  .panel{border-radius:12px;padding:16px 18px;margin:14px 0}
  .panel.ok{background:var(--oksoft);border:1px solid #86efac;color:#14532d}
  .panel.bad{background:var(--badsoft);border:1px solid #fca5a5;color:#7f1d1d}
  .panel.info{background:#f8fafc;border:1px solid var(--line);color:var(--ink2)}
  .panel h3{margin:0 0 6px;font-size:16px}
  .segs{display:flex;flex-direction:column;gap:8px;margin-top:10px}
  .seg{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #fecaca;border-radius:10px;padding:8px 10px;color:var(--ink)}
  .seg .st{flex:1;font-size:14px} .seg .st small{display:block;color:var(--muted);font-size:12px}
  .seg .cv{font-size:12px;font-weight:800;color:var(--muted);width:72px;text-align:right}
  .seg.full .cv{color:var(--ok)}
  /* 마인드맵 */
  .mm{overflow-x:auto;padding-bottom:6px}
  .mm-top{display:flex;justify-content:center;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px}
  .mm-root{font-size:20px;font-weight:900;border:3px solid var(--ink);border-radius:12px;padding:10px 18px;background:#fff}
  .mm-side{display:flex;align-items:center;gap:8px} .mm-side .lab{font-weight:900;border:2px solid var(--ink);border-radius:10px;padding:6px 12px;white-space:nowrap}
  .mm-cols{display:grid;grid-template-columns:repeat(var(--cols),minmax(150px,1fr));gap:10px;border-top:3px solid var(--ink);padding-top:14px;min-width:calc(var(--cols)*160px)}
  .mm-col{display:flex;flex-direction:column;gap:7px}
  .mm-title{font-weight:900;border:2px solid var(--ink);border-radius:10px;padding:6px 10px;text-align:center;background:#fff;position:relative}
  .mm-title small{display:block;font-size:11px;color:#c2410c;font-weight:800}
  .mm-node{border:1px solid #94a3b8;border-radius:8px;padding:6px 10px;font-size:14px;background:#fff;margin-left:10px;min-height:36px;display:flex;align-items:center}
  .mm-node .hint{font-size:11px;color:#c2410c;font-weight:800;margin-left:6px}
  .slot{border:2px dashed #7dd3fc;background:#f0f9ff;cursor:pointer;color:#0369a1;justify-content:center;font-weight:700}
  .slot.filled{border-style:solid;border-color:var(--brand);background:#fff;color:var(--ink)}
  .slot.target{box-shadow:0 0 0 3px #bae6fd}
  .bank{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding:14px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;min-height:56px}
  .chip{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:14px;cursor:grab}
  .chip.pick{border-color:var(--brand);background:var(--soft);box-shadow:0 0 0 2px #7dd3fc}
  @media (max-width:640px){.mm-cols{grid-template-columns:1fr;min-width:0}.mm-node{margin-left:16px}.bank{position:sticky;bottom:8px;max-height:38vh;overflow:auto;box-shadow:0 -6px 18px -8px rgba(15,23,42,.25);background:#f8fafc}}
  /* 독해 */
  .passage{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 18px;white-space:pre-line;font-size:15.5px;line-height:1.85}
  textarea.ans{width:100%;min-height:110px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:15px;resize:vertical;margin-top:8px}
  textarea.ans:focus,input.name:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px #e0f2fe}
  input.name{border:1px solid var(--line);border-radius:10px;padding:12px 14px;font:inherit;font-size:16px;width:100%;max-width:320px}
  .done-card{text-align:center;padding:36px 22px} .done-card .big{font-size:44px}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.title = `Unit ${pad(U.id)} · ${U.title} | 천일문 기본`;

  /* ---------- 화면 뼈대 ---------- */
  const app = document.getElementById('app');
  let view = Math.min(S.stage || 0, unlockedUpTo(), STAGES.length - 1);

  function shell() {
    const unlocked = unlockedUpTo();
    app.innerHTML = `
    <div class="wrap">
      <div class="top"><a href="index.html">← 목차</a>
        <span class="who">${student ? `학생: <b>${esc(student)}</b> <button id="chName">바꾸기</button>` : ''}</span></div>
      <div class="card head">
        <div><span class="badge">${U.id === 0 ? '예비 수업' : 'Unit ' + pad(U.id)}</span><span class="note">${esc(U.chapter || '')}</span></div>
        <h1>${esc(U.title)}</h1>
        <p>강의 ${required.length}개${U.lectures.length > required.length ? ` (+선택 ${U.lectures.length - required.length}개)` : ''} · ${STAGES.map(s => s.name).join(' → ')}</p>
        <div class="steps">${STAGES.map((s, i) => {
          const cls = i === view ? 'on' : stageDone(s.id) ? 'done' : i > unlocked ? 'lock' : '';
          return `<div class="step ${cls}" data-i="${i}"><span class="n">${stageDone(s.id) ? '✓' : i + 1}</span>${s.name}</div>`;
        }).join('')}</div>
      </div>
      <div id="stage"></div>
    </div>`;
    $$('.step').forEach(el => el.onclick = () => { const i = +el.dataset.i; if (i <= unlockedUpTo() && i < STAGES.length) go(i); });
    const ch = $('#chName'); if (ch) ch.onclick = () => { student = ''; store.set('cb_student', ''); start(); };
  }

  function go(i) { view = i; S.stage = Math.max(S.stage || 0, i); save(); stopPlayers(); shell(); renderStage(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function renderStage() {
    if (allDone() && view >= STAGES.length) return renderDone();
    const s = STAGES[view];
    ({ lec: renderLectures, quiz: renderQuiz, mm: renderMindmap, rd: renderReading })[s.id]();
  }
  function nextStage() {
    if (view + 1 < STAGES.length) go(view + 1);
    else { view = STAGES.length; finish(); shell(); renderDone(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }
  function finish() {
    if (!store.get('cb_done_' + pad(U.id), false)) { store.set('cb_done_' + pad(U.id), true); log('unit_complete', {}); }
  }
  function renderDone() {
    const next = U.id + 1 <= 101 ? `catbookpt${pad(U.id + 1)}.html` : null;
    $('#stage').innerHTML = `<div class="card done-card"><div class="big">🎉</div>
      <h2 class="sec">${U.id === 0 ? '예비 수업' : 'Unit ' + pad(U.id)}을 모두 마쳤어요</h2>
      <p class="sub">수고했어요. 다음 Unit으로 넘어가세요.</p>
      <div class="row" style="justify-content:center">
        <a class="btn ghost" href="index.html">목차로</a>${next ? `<a class="btn" href="${next}">다음 Unit →</a>` : ''}</div></div>`;
  }

  const players = [];
  function stopPlayers() { players.splice(0).forEach(p => { clearInterval(p.timer); try { p.player && p.player.destroy(); } catch (e) { } }); }

  /* =================== ① 강의 듣기 =================== */
  function renderLectures() {
    const box = $('#stage');
    let cur = Math.max(0, U.lectures.findIndex(l => !lecState(l.id).done && !l.optional));
    box.innerHTML = `<div class="card">
      <h2 class="sec">① 강의 듣기</h2>
      <p class="sub">강의를 순서대로 들으세요. 각 강의를 ${Math.round(LECTURE_DONE * 100)}% 이상 들으면 완료로 표시돼요. 건너뛰거나 빨리 감은 부분은 들은 것으로 치지 않아요.</p>
      <div class="player"><div id="ytMain"></div><div class="msg" id="ytMsg">강의를 불러오는 중…</div></div>
      <ol class="lecs">${U.lectures.map((l, i) => `
        <li><button class="lec" data-i="${i}">
          <span class="no">${i + 1}강</span>
          <span class="tt"><b>${esc(l.title)}${l.optional ? '<span class="tag opt">선택</span>' : ''}</b><small>${esc(l.book || '')}</small><div class="bar"><i></i></div></span>
          <span class="pct"></span></button></li>`).join('')}</ol>
      <div class="row"><span class="grow note" id="lecNote"></span>
        <button class="btn" id="lecNext">${STAGES.length > 1 ? '다음 단계: ' + STAGES[1].name + ' →' : '이 Unit 마치기'}</button></div>
    </div>`;

    const refresh = () => {
      $$('.lec', box).forEach(b => {
        const l = U.lectures[+b.dataset.i], s = lecState(l.id), c = lecCoverage(l.id);
        b.classList.toggle('cur', +b.dataset.i === cur);
        b.classList.toggle('done', s.done);
        $('.bar i', b).style.width = Math.round(c * 100) + '%';
        $('.pct', b).textContent = s.done ? '✓ 완료' : s.dur ? Math.round(c * 100) + '%' : '';
      });
      const left = required.filter(l => !lecState(l.id).done).length;
      $('#lecNext').disabled = left > 0;
      $('#lecNote').textContent = left ? `남은 강의 ${left}개` : '모든 강의를 들었어요!';
    };
    refresh();

    let watched = null, saveTick = 0;
    const P = makePlayer('ytMain', U.lectures[cur].id, ev => {
      const l = U.lectures[cur], s = lecState(l.id);
      const p = P.player;
      if (!s.dur && p.getDuration) s.dur = p.getDuration() || 0;
      if (!ev.playing) return;
      if (ev.jumped > 0) s.seeks++;
      s.maxRate = Math.max(s.maxRate, ev.rate);
      if (ev.hidden) s.hidden += ev.dt;
      if (!ev.jumped) watched.add(Math.floor(ev.t));
      s.pos = ev.t;
      if (++saveTick % 6 === 0 || !s.done) {
        s.ranges = encodeRanges(watched);
        if (!s.done && s.dur && watched.size / Math.floor(s.dur) >= LECTURE_DONE) {
          s.done = true;
          log('lecture_done', { lecture: (cur + 1) + '강 ' + l.title, coverage: Math.round(watched.size / Math.floor(s.dur) * 100) + '%', seeks: s.seeks, maxRate: s.maxRate, hiddenSec: Math.round(s.hidden) });
        }
        save(); refresh();
      }
    });
    players.push(P);
    const load = i => {
      cur = i; const l = U.lectures[i], s = lecState(l.id);
      watched = decodeRanges(s.ranges);
      P.reset();
      P.ready.then(p => { p.cueVideoById({ videoId: l.id, startSeconds: s.done ? 0 : Math.max(0, (s.pos || 0) - 3) }); $('#ytMsg') && $('#ytMsg').remove(); });
      refresh();
    };
    P.ready.then(() => P.start()).catch(() => { $('#ytMsg').textContent = '유튜브 강의를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.'; });
    $$('.lec', box).forEach(b => b.onclick = () => load(+b.dataset.i));
    load(cur);
    $('#lecNext').onclick = () => { if (STAGES.length === 1) { view = 1; finish(); shell(); renderDone(); } else go(1); };
  }

  /* =================== ② 이해 확인 (객관식) =================== */
  const QS = U.quiz ? U.quiz.questions : [];
  const PASS = U.quiz ? (U.quiz.pass || 0.8) : 0;
  const needCorrect = Math.ceil(QS.length * PASS);
  function newAttempt() {
    S.quiz.cur = { order: shuffle(QS.map((_, i) => i)), choices: QS.map(q => shuffle(q.choices.map((_, i) => i))), picks: {} };
    save();
  }
  function segOf(q) {
    const lec = U.lectures[q.lecture || 0];
    return { key: (q.lecture || 0) + '@' + q.from + '-' + q.to, lecture: q.lecture || 0, vid: lec.id, from: toSec(q.from), to: toSec(q.to), label: `${(q.lecture || 0) + 1}강 ${q.from} ~ ${q.to}`, title: lec.title };
  }

  function renderQuiz() {
    const box = $('#stage');
    if (S.quiz.passed) {
      const last = S.quiz.attempts[S.quiz.attempts.length - 1] || {};
      box.innerHTML = `<div class="card"><h2 class="sec">② 이해 확인</h2>
        <div class="panel ok"><h3>통과했어요 ✓</h3>${last.score != null ? `${QS.length}문항 중 ${last.score}개 정답 · ${S.quiz.attempts.length}번째 응시` : ''}</div>
        <div class="row"><span class="grow"></span><button class="btn" id="qNext">${view + 1 < STAGES.length ? '다음 단계: ' + STAGES[view + 1].name + ' →' : '이 Unit 마치기'}</button></div></div>`;
      $('#qNext').onclick = nextStage; return;
    }
    if (S.quiz.review) return renderReview();
    if (!S.quiz.cur) newAttempt();
    const C = S.quiz.cur, n = S.quiz.attempts.length + 1;
    box.innerHTML = `<div class="card">
      <h2 class="sec">② 이해 확인 ${n > 1 ? `<span class="note">· ${n}번째 응시</span>` : ''}</h2>
      <p class="sub">${QS.length}문항 중 ${needCorrect}개 이상 맞히면 다음 단계로 넘어가요. 틀리면 해당 강의 구간을 다시 듣고 재응시합니다.</p>
      ${C.order.map((qi, k) => { const q = QS[qi]; return `
        <div class="q" data-q="${qi}"><div class="qt"><span class="qn">${k + 1}.</span>${esc(q.q)}</div>
        ${q.box ? `<div class="box">${esc(q.box)}</div>` : ''}
        ${C.choices[qi].map((ci, j) => `<label class="opt ${C.picks[qi] === ci ? 'sel' : ''}"><input type="radio" name="q${qi}" value="${ci}" ${C.picks[qi] === ci ? 'checked' : ''}> <span>${'①②③④⑤⑥'[j]} ${esc(q.choices[ci])}</span></label>`).join('')}
        </div>`; }).join('')}
      <div class="row"><span class="grow note" id="qLeft"></span><button class="btn" id="qSubmit">제출하기</button></div>
    </div>`;
    const upd = () => { const left = QS.length - Object.keys(C.picks).length; $('#qLeft').textContent = left ? `아직 ${left}문항을 고르지 않았어요` : ''; $('#qSubmit').disabled = left > 0; };
    $$('input[type=radio]', box).forEach(r => r.onchange = () => {
      const qi = +r.name.slice(1); C.picks[qi] = +r.value; save();
      $$(`.q[data-q="${qi}"] .opt`, box).forEach(o => o.classList.toggle('sel', $('input', o).checked));
      upd();
    });
    upd();
    $('#qSubmit').onclick = () => {
      if (!confirm('제출할까요? 제출하면 답을 바꿀 수 없어요.')) return;
      const wrong = QS.map((q, i) => i).filter(i => C.picks[i] !== QS[i].answer);
      const score = QS.length - wrong.length;
      const passed = score >= needCorrect;
      const att = { n, score, total: QS.length, wrong: wrong.map(i => QS[i].id || 'Q' + (i + 1)), at: Date.now() };
      S.quiz.attempts.push(att);
      log('quiz_attempt', { attempt: n, score: `${score}/${QS.length}`, result: passed ? '통과' : '미통과', wrong: att.wrong.join(', ') });
      S.quiz.cur = null;
      if (passed) { S.quiz.passed = true; save(); shell(); renderQuiz(); return; }
      const segs = []; wrong.forEach(i => { const sg = segOf(QS[i]); if (!segs.some(x => x.key === sg.key)) segs.push(sg); });
      S.quiz.review = { failedAt: Date.now(), segs: segs.map(s => Object.assign(s, { watched: '', seeks: 0, maxRate: 1, hidden: 0 })) };
      save(); renderReview(); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  function renderReview() {
    const box = $('#stage'), R = S.quiz.review, last = S.quiz.attempts[S.quiz.attempts.length - 1];
    box.innerHTML = `<div class="card">
      <h2 class="sec">② 이해 확인</h2>
      <div class="panel bad"><h3>아직 통과하지 못했어요 (${last.score}/${last.total})</h3>
        ${needCorrect}개 이상 맞혀야 해요. 정답은 알려주지 않아요. 틀린 문제와 관련된 강의 구간을 다시 듣고 재응시하세요.
        <div class="segs">${R.segs.map((s, i) => `<div class="seg" data-i="${i}"><span class="st"><b>${esc(s.label)}</b><small>${esc(s.title)} · ${fmt(s.to - s.from)}</small></span>
          <span class="cv"></span><button class="btn sm ghost" data-play="${i}">▶ 다시 듣기</button></div>`).join('')}</div>
      </div>
      <div class="player" style="margin-top:14px"><div id="ytReview"></div><div class="msg" id="rvMsg">위에서 ‘다시 듣기’를 누르세요</div></div>
      <div class="row"><span class="grow note">다시 들은 기록은 선생님께 함께 전달돼요.</span><button class="btn" id="qRetry">재응시하기</button></div>
    </div>`;
    let curSeg = -1, set = null;
    const refresh = () => $$('.seg', box).forEach(el => {
      const s = R.segs[+el.dataset.i], len = Math.max(1, s.to - s.from), c = Math.min(1, decodeRanges(s.watched).size / len);
      $('.cv', el).textContent = c ? Math.round(c * 100) + '% 들음' : '';
      el.classList.toggle('full', c >= 0.9);
    });
    refresh();
    const P = makePlayer('ytReview', R.segs[0].vid, ev => {
      if (curSeg < 0) return; const s = R.segs[curSeg];
      if (!ev.playing) return;
      if (ev.jumped > 0) s.seeks++;
      s.maxRate = Math.max(s.maxRate, ev.rate);
      if (ev.hidden) s.hidden += ev.dt;
      const sec = Math.floor(ev.t);
      if (!ev.jumped && sec >= s.from && sec < s.to) { set.add(sec); s.watched = encodeRanges(set); save(); refresh(); }
      if (ev.t >= s.to) P.player.pauseVideo();
    });
    players.push(P);
    P.ready.then(() => P.start()).catch(() => { $('#rvMsg').textContent = '유튜브 강의를 불러오지 못했어요. 새로고침해 주세요.'; });
    $$('[data-play]', box).forEach(b => b.onclick = () => {
      curSeg = +b.dataset.play; const s = R.segs[curSeg]; set = decodeRanges(s.watched); P.reset();
      P.ready.then(p => { const m = $('#rvMsg'); m && m.remove(); p.loadVideoById({ videoId: s.vid, startSeconds: s.from, endSeconds: s.to }); });
    });
    $('#qRetry').onclick = () => {
      const elapsed = (Date.now() - R.failedAt) / 1000;
      const total = R.segs.reduce((a, s) => a + (s.to - s.from), 0);
      const flags = [];
      const detail = R.segs.map(s => {
        const len = Math.max(1, s.to - s.from), c = decodeRanges(s.watched).size / len;
        if (c < 0.8) flags.push(`${s.label} ${Math.round(c * 100)}%만 들음`);
        if (s.seeks >= 2) flags.push(`${s.label} 건너뛰기 ${s.seeks}회`);
        if (s.maxRate > 1.5) flags.push(`${s.label} ${s.maxRate}배속`);
        if (s.hidden > 20) flags.push(`${s.label} 다른 창 ${Math.round(s.hidden)}초`);
        return `${s.label}: ${Math.round(c * 100)}% (건너뛰기 ${s.seeks}, 최대 ${s.maxRate}배속, 다른 창 ${Math.round(s.hidden)}초)`;
      });
      if (elapsed < total * 0.8) flags.push(`재응시까지 ${fmt(elapsed)} (다시 들을 구간 합계 ${fmt(total)})`);
      if (flags.length && !confirm('아직 다 듣지 않은 구간이 있어요. 그래도 재응시할까요?\n(다시 들은 기록은 선생님께 전달돼요)')) return;
      log('quiz_retry', { attempt: S.quiz.attempts.length + 1, elapsed: fmt(elapsed), segTotal: fmt(total), review: detail.join(' / '), flags: flags.join(' / ') });
      S.quiz.review = null; newAttempt(); stopPlayers(); renderQuiz(); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  /* =================== ③ 마인드맵 =================== */
  function renderMindmap() {
    const M = U.mindmap, box = $('#stage');
    // 빈칸 목록 만들기
    const slots = [];
    const node = (n, where, style) => {
      const st = style ? ` style="${style}"` : '';
      if (n && n.blank) { const id = slots.length; slots.push({ id, answer: n.text, where }); return `<div class="mm-node slot" data-slot="${id}"${st}>?</div>`; }
      const t = typeof n === 'string' ? n : n.text;
      return `<div class="mm-node"${st}>${esc(t)}${n.hint ? `<span class="hint">${esc(n.hint)}</span>` : ''}</div>`;
    };
    const sideHtml = (M.side || []).map(sd => `<div class="mm-side"><span class="lab">${esc(sd.label)}</span>—${node(sd.node, sd.label, 'margin-left:0;min-width:150px')}${sd.hint ? `<span class="note" style="color:#c2410c;font-weight:800">${esc(sd.hint)}</span>` : ''}</div>`).join('');
    const colsHtml = M.branches.map(b => `<div class="mm-col"><div class="mm-title">${b.hint ? `<small>${esc(b.hint)}</small>` : ''}${esc(b.title)}</div>${b.children.map(c => node(c, b.title)).join('')}</div>`).join('');
    const bankWords = shuffle(slots.map(s => s.answer).concat(M.distractors || []));
    if (S.mm.passed) {
      box.innerHTML = `<div class="card"><h2 class="sec">③ 마인드맵</h2><div class="panel ok"><h3>마인드맵을 완성했어요 ✓</h3>${S.mm.attempts}번 만에 완성</div>
        <div class="row"><span class="grow"></span><button class="btn" id="mNext">${view + 1 < STAGES.length ? '다음 단계: ' + STAGES[view + 1].name + ' →' : '이 Unit 마치기'}</button></div></div>`;
      $('#mNext').onclick = nextStage; return;
    }
    box.innerHTML = `<div class="card">
      <h2 class="sec">③ 마인드맵</h2>
      <p class="sub">아래 낱말 카드를 빈칸에 채워 마인드맵을 완성하세요. 카드를 누른 뒤 빈칸을 누르면 들어가요(끌어다 놓아도 돼요). 채운 칸을 다시 누르면 빠집니다. 필요 없는 카드도 섞여 있어요.</p>
      <div class="mm"><div class="mm-top"><div class="mm-root">${esc(M.root)}</div>${sideHtml}</div>
        <div class="mm-cols" style="--cols:${M.branches.length}">${colsHtml}</div></div>
      <div class="bank" id="bank"></div>
      <div id="mmMsg"></div>
      <div class="row"><span class="grow note" id="mmLeft"></span><button class="btn" id="mmCheck">확인하기</button></div>
    </div>`;
    // 상태: placed[slotId] = 카드 번호
    const placed = {}; let pick = null;
    const cards = bankWords.map((w, i) => ({ i, w }));
    const draw = () => {
      const used = new Set(Object.values(placed));
      $('#bank').innerHTML = cards.filter(c => !used.has(c.i)).map(c => `<button class="chip ${pick === c.i ? 'pick' : ''}" draggable="true" data-c="${c.i}">${esc(c.w)}</button>`).join('') || '<span class="note">모든 카드를 썼어요</span>';
      $$('.slot', box).forEach(el => {
        const sid = +el.dataset.slot, ci = placed[sid];
        el.textContent = ci == null ? '?' : cards[ci].w; el.classList.toggle('filled', ci != null);
      });
      $$('.chip', box).forEach(ch => {
        ch.onclick = () => { pick = pick === +ch.dataset.c ? null : +ch.dataset.c; draw(); };
        ch.ondragstart = e => { e.dataTransfer.setData('text/plain', ch.dataset.c); };
      });
      const left = slots.length - Object.keys(placed).length;
      $('#mmLeft').textContent = left ? `빈칸 ${left}개 남음` : '모든 빈칸을 채웠어요';
      $('#mmCheck').disabled = left > 0;
    };
    $$('.slot', box).forEach(el => {
      const sid = +el.dataset.slot;
      el.onclick = () => { if (pick != null) { placed[sid] = pick; pick = null; } else if (placed[sid] != null) { delete placed[sid]; } draw(); };
      el.ondragover = e => { e.preventDefault(); el.classList.add('target'); };
      el.ondragleave = () => el.classList.remove('target');
      el.ondrop = e => { e.preventDefault(); el.classList.remove('target'); placed[sid] = +e.dataTransfer.getData('text/plain'); pick = null; draw(); };
    });
    draw();
    $('#mmCheck').onclick = () => {
      const wrong = slots.filter(s => cards[placed[s.id]].w !== s.answer);
      S.mm.attempts++;
      const ok = slots.length - wrong.length, passNeed = Math.ceil(slots.length * (M.pass || 1));
      log('mindmap_attempt', { attempt: S.mm.attempts, score: `${ok}/${slots.length}`, result: ok >= passNeed ? '통과' : '미통과', wrong: wrong.map(s => `${s.where}:${s.answer}`).join(', ') });
      if (ok >= passNeed) { S.mm.passed = true; save(); shell(); renderMindmap(); return; }
      save();
      $('#mmMsg').innerHTML = `<div class="panel bad"><h3>${slots.length}칸 중 ${wrong.length}칸이 틀렸어요</h3>어느 칸인지는 알려주지 않아요. 다시 생각해서 고쳐 보세요.${M.review ? ` 헷갈리면 ${esc(M.review)} 부분을 다시 들어 보세요.` : ''}</div>`;
    };
  }

  /* =================== ④ 독해·쓰기 =================== */
  function renderReading() {
    const R = U.reading, box = $('#stage');
    const DKEY = KEY + '_draft';
    const draft = store.get(DKEY, {});
    if (S.rd.submitted) {
      box.innerHTML = `<div class="card"><h2 class="sec">④ 독해·쓰기</h2><div class="panel ok"><h3>제출했어요 ✓</h3>선생님이 채점한 뒤 알려줄 거예요.</div>
        <div class="row"><span class="grow"></span><button class="btn" id="rNext">이 Unit 마치기</button></div></div>`;
      $('#rNext').onclick = nextStage; return;
    }
    box.innerHTML = `<div class="card">
      <h2 class="sec">④ 독해·쓰기</h2>
      <p class="sub">${esc(R.intro || '지문을 읽고 물음에 답하세요. 다 쓰면 제출하세요. 채점은 선생님이 합니다.')}</p>
      ${R.passage ? `<div class="passage">${esc(R.passage)}</div>` : ''}
      ${R.questions.map((q, i) => `<div class="q" style="margin-top:14px"><div class="qt"><span class="qn">${i + 1}.</span>${esc(q.prompt)}</div>
        ${q.box ? `<div class="box">${esc(q.box)}</div>` : ''}
        <textarea class="ans" data-i="${i}" placeholder="여기에 답을 쓰세요">${esc(draft[i] || '')}</textarea></div>`).join('')}
      <div class="row"><span class="grow note" id="rLeft"></span><button class="btn" id="rSubmit">제출하기</button></div>
    </div>`;
    const upd = () => {
      const vals = $$('textarea.ans', box).map(t => t.value.trim());
      const left = vals.filter(v => v.length < (R.minChars || 2)).length;
      $('#rLeft').textContent = left ? `아직 쓰지 않은 답이 ${left}개 있어요` : '쓴 내용은 자동으로 임시 저장돼요';
      $('#rSubmit').disabled = left > 0;
    };
    $$('textarea.ans', box).forEach(t => t.oninput = () => { draft[t.dataset.i] = t.value; store.set(DKEY, draft); upd(); });
    upd();
    $('#rSubmit').onclick = () => {
      if (!confirm('제출할까요? 제출하면 고칠 수 없어요.')) return;
      const vals = $$('textarea.ans', box).map(t => t.value.trim());
      const text = [`[천일문 기본 Unit ${pad(U.id)}] ${U.title}`, `학생: ${student}`, `제출: ${new Date().toLocaleString('ko-KR')}`, '']
        .concat(R.questions.map((q, i) => `${i + 1}. ${q.prompt}\n답: ${vals[i]}`)).join('\n');
      log('reading_submit', { answersText: text });
      S.rd.submitted = true; S.rd.answers = vals; save();
      shell(); renderReading();
    };
  }

  /* ---------- 시작: 이름 입력 ---------- */
  function start() {
    if (!student) {
      app.innerHTML = `<div class="wrap"><div class="top"><a href="index.html">← 목차</a></div>
        <div class="card" style="max-width:480px;margin:40px auto">
          <span class="badge" style="font-size:12px;font-weight:800;color:#0369a1;background:#e0f2fe;border-radius:6px;padding:2px 8px">${U.id === 0 ? '예비 수업' : 'Unit ' + pad(U.id)}</span>
          <h2 class="sec" style="margin-top:10px">이름을 입력하세요</h2>
          <p class="sub">공부한 기록이 이 이름으로 선생님께 전달돼요.</p>
          <input class="name" id="nm" placeholder="이름" autocomplete="name">
          <div class="row"><button class="btn" id="nmGo">시작하기</button></div></div></div>`;
      const go2 = () => { const v = $('#nm').value.trim(); if (!v) return $('#nm').focus(); student = v; store.set('cb_student', v); log('start', {}); start(); };
      $('#nmGo').onclick = go2; $('#nm').onkeydown = e => { if (e.key === 'Enter') go2(); };
      return;
    }
    if (!S.started) { S.started = Date.now(); save(); log('unit_open', {}); }
    if (allDone()) { view = STAGES.length; finish(); shell(); return renderDone(); }
    shell(); renderStage();
  }
  flush();
  start();
})();
