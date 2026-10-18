/* =====================================================================
   천일문 기본 · 학습 엔진 (모든 Unit 페이지가 함께 씀)
   각 catbookptNN.html 은 window.UNIT 에 내용만 적고 이 파일을 불러옵니다.
   강의마다: 강의 → 익히기(quiz) → 마인드맵(mindmaps) / 안내만(note) / 문장 익히기(sentences)
   ===================================================================== */
(function () {
  'use strict';
  const U = window.UNIT;
  U.lectures = (U.lectures || []).map((L, i) => Object.assign({ no: (i + 1) + '강', book: '' }, L));
  U.chapter = U.chapter || '';
  const CFG = window.LESSON_CONFIG || {};
  const DONE_RATIO = 0.9;
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const toSec = s => String(s).split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  const fmt = sec => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + pad(s); };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const NUM = '①②③④⑤⑥⑦⑧';

  /* ---------------- 저장 ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  const KEY = 'cb_u' + pad(U.id) + '_v2';
  const S = Object.assign({ quiz: {}, mm: {}, sent: {} }, store.get(KEY, {}));
  const VID = {};
  const vstate = id => VID[id] || (VID[id] = Object.assign({ ranges: '', dur: 0, pos: 0, done: false, seeks: 0, maxRate: 1, hidden: 0 }, store.get('cb_v_' + id, {})));
  const save = () => { store.set(KEY, S); Object.keys(VID).forEach(k => store.set('cb_v_' + k, VID[k])); };
  let student = store.get('cb_student', '');

  /* ---------------- 시트 기록 ---------------- */
  const QKEY = 'cb_queue';
  function log(event, data) {
    const row = Object.assign({ clientTime: new Date().toISOString(), student, unit: 'Unit ' + pad(U.id), unitTitle: U.title, event }, data || {});
    if (!CFG.endpoint) { console.log('[기록 — 시트 주소 미설정]', row); return; }
    const q = store.get(QKEY, []); q.push(row); store.set(QKEY, q); flush();
  }
  let flushing = false;
  async function flush() {
    if (flushing || !CFG.endpoint) return; flushing = true;
    try {
      let q = store.get(QKEY, []);
      while (q.length) {
        await fetch(CFG.endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(q[0]) });
        q = store.get(QKEY, []); q.shift(); store.set(QKEY, q);
      }
    } catch (e) { }
    flushing = false;
  }
  window.addEventListener('online', flush);

  /* ---------------- 시청 구간 ---------------- */
  const enc = set => { const a = [...set].sort((x, y) => x - y), o = []; let s = null, p = null; for (const v of a) { if (s === null) s = p = v; else if (v === p + 1) p = v; else { o.push(s === p ? s : s + '-' + p); s = p = v; } } if (s !== null) o.push(s === p ? s : s + '-' + p); return o.join(','); };
  const dec = str => { const set = new Set(); if (!str) return set; String(str).split(',').forEach(r => { const [a, b] = r.split('-').map(Number); for (let i = a; i <= (isNaN(b) ? a : b); i++) set.add(i); }); return set; };

  /* ---------------- 유튜브 ---------------- */
  let ytP = null;
  function loadYT() {
    if (ytP) return ytP;
    ytP = new Promise((res, rej) => {
      if (location.protocol === 'file:') return rej(new Error('file'));
      if (window.YT && window.YT.Player) return res(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); res(window.YT); };
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => rej(new Error('net')); document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) rej(new Error('net')); }, 15000);
    });
    return ytP;
  }
  const ytErrMsg = e => e && e.message === 'file'
    ? '내 컴퓨터에서 파일을 직접 열면 유튜브가 재생을 막아요(오류 153). 깃허브 페이지 주소로 열어 주세요.'
    : '유튜브 강의를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
  const players = [];
  function stopPlayers() { players.splice(0).forEach(p => { clearInterval(p.timer); try { p.player && p.player.destroy(); } catch (e) { } }); }
  function makePlayer(elId, videoId, onTick) {
    const api = {};
    api.ready = loadYT().then(YT => new Promise(res => {
      api.player = new YT.Player(elId, {
        width: '100%', height: '100%', videoId,
        playerVars: Object.assign({ rel: 0, modestbranding: 1, playsinline: 1 }, /^https?:$/.test(location.protocol) ? { origin: location.origin } : {}),
        events: { onReady: () => res(api.player) }
      });
    }));
    let lastT = null, lastW = null;
    api.reset = () => { lastT = null; lastW = null; };
    api.ready.then(() => {
      let lastRate = 1;
      const tick = () => {
        const p = api.player; if (!p || !p.getPlayerState) return;
        const playing = p.getPlayerState() === 1, t = p.getCurrentTime() || 0, rate = p.getPlaybackRate ? p.getPlaybackRate() : 1, now = performance.now();
        const prevT = lastT, dt = lastW ? (now - lastW) / 1000 : 0;
        let jumped = 0; const secs = [];
        if (prevT !== null) {
          const d = t - prevT, maxD = dt * Math.max(rate, lastRate) + 3;
          if (d > maxD) jumped = d;                                   // 앞으로 건너뜀
          else if (d >= 0) { for (let k = Math.floor(prevT); k <= Math.floor(t); k++) secs.push(k); }   // 정상 재생(멈춘 시간 포함)
          // d < 0 : 뒤로 돌아감 → 들은 것으로 치지 않음
        }
        lastT = t; lastW = now; lastRate = rate;
        onTick({ t, playing, rate, jumped, hidden: document.hidden, dt, p, secs: (playing || d0(prevT, t)) ? secs : [] });
      };
      const d0 = (a, b) => a !== null && b > a + 0.5;   // 멈춘 상태지만 직전 감시 이후 재생된 경우
      tick();
      api.timer = setInterval(tick, 500);
    });
    players.push(api);
    return api;
  }

  /* ---------------- 단계 목록 ---------------- */
  const STEPS = [];
  U.lectures.forEach((L, li) => {
    STEPS.push({ kind: 'watch', li, name: L.optional ? '강의(선택)' : '강의' });
    if (L.quiz) STEPS.push({ kind: 'quiz', li, name: '익히기' });
    (L.mindmaps || []).forEach((m, mi) => STEPS.push({ kind: 'mm', li, mi, name: L.mindmaps.length > 1 ? '마인드맵 ' + (mi + 1) : '마인드맵' }));
    if (L.sentences) STEPS.push({ kind: 'sent', li, name: '문장 익히기' });
  });
  const lecLabel = li => `${U.lectures[li].no} ${U.lectures[li].title}`;
  const stepDone = st => {
    if (st.kind === 'watch') return vstate(U.lectures[st.li].id).done || !!U.lectures[st.li].optional;
    if (st.kind === 'quiz') return !!(S.quiz[st.li] && S.quiz[st.li].passed);
    if (st.kind === 'mm') return !!(S.mm[st.li + '-' + st.mi] && S.mm[st.li + '-' + st.mi].passed);
    if (st.kind === 'sent') return !!S.sent.submitted;
  };
  const shownDone = st => st.kind === 'watch' ? vstate(U.lectures[st.li].id).done : stepDone(st);   // ✓ 표시용 (선택 강의는 들었을 때만)
  const firstOpen = () => { let i = 0; while (i < STEPS.length && stepDone(STEPS[i])) i++; return i; };
  const allDone = () => firstOpen() >= STEPS.length;

  /* ---------------- 스타일 ---------------- */
  document.head.insertAdjacentHTML('beforeend', `<style>
  :root{--bg:#f1f5f9;--card:#fff;--ink:#0f172a;--ink2:#334155;--muted:#64748b;--line:#e2e8f0;--brand:#0284c7;--brand2:#0369a1;--soft:#e0f2fe;--ok:#16a34a;--oksoft:#dcfce7;--bad:#dc2626;--badsoft:#fee2e2;--orange:#ea580c}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:'Noto Sans KR',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;line-height:1.6}
  .wrap{max-width:1000px;margin:0 auto;padding:20px 16px 80px}
  .top{display:flex;align-items:center;gap:10px;margin-bottom:14px;font-size:14px} .top a{color:var(--brand2);text-decoration:none;font-weight:700}
  .top .who{margin-left:auto;color:var(--muted)} .top .who button{border:0;background:none;color:var(--brand2);cursor:pointer;font:inherit;text-decoration:underline}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 6px 18px -10px rgba(15,23,42,.18);margin-bottom:16px}
  .badge{display:inline-block;font-size:12px;font-weight:800;color:var(--brand2);background:var(--soft);border-radius:6px;padding:2px 8px;margin-right:6px}
  h1{font-size:24px;margin:8px 0 2px;font-weight:900} .muted{color:var(--muted);font-size:14px}
  .prog{display:flex;flex-direction:column;gap:6px;margin-top:16px}
  .prow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0;border-top:1px dashed var(--line)}
  .prow .pl{font-size:14px;font-weight:700;min-width:240px;flex:1} .prow .pl small{color:var(--muted);font-weight:400;margin-left:4px}
  .pills{display:flex;gap:6px;flex-wrap:wrap}
  .pill{font:inherit;font-size:12.5px;font-weight:700;border-radius:999px;padding:4px 11px;border:1px solid var(--line);background:#f8fafc;color:#94a3b8;cursor:default}
  .pill.open{color:var(--ink2);background:#fff;border-color:#cbd5e1;cursor:pointer}
  .pill.done{color:var(--ok);background:var(--oksoft);border-color:#86efac;cursor:pointer}
  .pill.on{color:#fff;background:var(--brand);border-color:var(--brand)}
  h2{font-size:19px;margin:0 0 4px;font-weight:900} p.sub{margin:0 0 16px;color:var(--muted);font-size:14px}
  .player{position:relative;width:100%;aspect-ratio:16/9;background:#0f172a;border-radius:12px;overflow:hidden}
  .player>div,.player iframe{position:absolute;inset:0;width:100%;height:100%}
  .player .msg{position:absolute;inset:0;display:grid;place-items:center;color:#cbd5e1;font-size:14px;text-align:center;padding:20px}
  .bar{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-top:12px} .bar i{display:block;height:100%;background:var(--brand);width:0}
  .bar.full i{background:var(--ok)}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:10px;padding:12px 22px;font:inherit;font-weight:800;font-size:15px;cursor:pointer;background:var(--brand);color:#fff;text-decoration:none}
  .btn:hover{background:var(--brand2)} .btn:disabled{background:#94a3b8;cursor:not-allowed}
  .btn.ghost{background:#fff;color:var(--brand2);border:1px solid #bae6fd} .btn.sm{padding:7px 12px;font-size:13px;border-radius:8px}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:18px} .grow{flex:1}
  .note{font-size:13px;color:var(--muted)}
  .notice{background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:12px;padding:12px 16px;margin-bottom:14px;font-weight:700}
  .q{border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;background:#fff}
  .q .qt{font-weight:700;margin-bottom:10px} .q .qn{color:var(--brand2);font-weight:900;margin-right:6px}
  .opt{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border:1px solid var(--line);border-radius:8px;margin-top:6px;cursor:pointer;font-size:14.5px}
  .opt:hover{background:#f8fafc} .opt input{margin-top:5px} .opt.sel{border-color:var(--brand);background:var(--soft)}
  .panel{border-radius:12px;padding:16px 18px;margin:14px 0} .panel h3{margin:0 0 6px;font-size:16px}
  .panel.ok{background:var(--oksoft);border:1px solid #86efac;color:#14532d} .panel.bad{background:var(--badsoft);border:1px solid #fca5a5;color:#7f1d1d}
  .segs{display:flex;flex-direction:column;gap:8px;margin-top:10px}
  .seg{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #fecaca;border-radius:10px;padding:8px 10px;color:var(--ink)}
  .seg .st{flex:1;font-size:14px} .seg .st small{display:block;color:var(--muted);font-size:12px}
  .seg .cv{font-size:12px;font-weight:800;color:var(--muted);width:72px;text-align:right} .seg.full .cv{color:var(--ok)}
  /* 마인드맵 */
  .mm-root{text-align:center;margin-bottom:12px} .mm-root span{display:inline-block;font-size:20px;font-weight:900;border:3px solid var(--ink);border-radius:12px;padding:10px 20px;background:#fff}
  .mm-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;border-top:3px solid var(--ink);padding-top:14px}
  .mm-br{display:flex;flex-direction:column}
  .mm-n{display:flex;flex-direction:column}
  .mm-box{border:1px solid #94a3b8;border-radius:8px;padding:6px 10px;font-size:14px;background:#fff;min-height:36px;display:flex;flex-direction:column;justify-content:center}
  .mm-br>.mm-n>.mm-box{border:2px solid var(--ink);font-weight:900;text-align:center;align-items:center}
  .mm-box .hint{font-size:11px;color:var(--orange);font-weight:800;line-height:1.3}
  .mm-kids{display:flex;flex-direction:column;gap:6px;margin:6px 0 0 10px;padding-left:10px;border-left:3px solid var(--ink)}
  .slot{border:2px dashed #7dd3fc;background:#f0f9ff;cursor:pointer;color:#0369a1;font-weight:700;text-align:center}
  .slot.filled{border-style:solid;border-color:var(--brand);background:#fff;color:var(--ink);font-weight:400;text-align:left}
  .slot.target{box-shadow:0 0 0 3px #bae6fd}
  .bank{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding:14px;border:1px dashed #cbd5e1;border-radius:12px;background:#f8fafc;min-height:56px}
  .chip{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:14px;cursor:grab;text-align:left}
  .chip.pick{border-color:var(--brand);background:var(--soft);box-shadow:0 0 0 2px #7dd3fc}
  /* 문장 */
  .sent{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px;background:#fff}
  .sent .en{font-size:16px;font-weight:700;font-family:Georgia,'Times New Roman',serif;line-height:1.5} .sent .en b{color:var(--brand2);font-family:'Noto Sans KR',sans-serif;margin-right:8px;font-size:13px}
  textarea.ans{width:100%;min-height:64px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:15px;resize:vertical;margin-top:8px}
  textarea.ans:focus,input.name:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px #e0f2fe}
  input.name{border:1px solid var(--line);border-radius:10px;padding:12px 14px;font:inherit;font-size:16px;width:100%;max-width:320px}
  .center{text-align:center;padding:36px 22px} .big{font-size:44px}
  @media (max-width:640px){.mm-cols{grid-template-columns:1fr}.bank{position:sticky;bottom:8px;max-height:38vh;overflow:auto;box-shadow:0 -6px 18px -8px rgba(15,23,42,.25)}.prow .pl{min-width:0;flex-basis:100%}}
  </style>`);
  document.title = `Unit ${pad(U.id)} · ${U.title} | 천일문 기본`;

  /* ---------------- 화면 ---------------- */
  const app = document.getElementById('app');
  let view = 0;

  function shell() {
    const open = firstOpen();
    let html = `<div class="wrap">
      <div class="top"><a href="index.html">← 목차</a><span class="who">학생: <b>${esc(student)}</b> <button id="chName">바꾸기</button></span></div>
      <div class="card"><span class="badge">Unit ${pad(U.id)}</span><span class="muted">${esc(U.chapter)}</span>
        <h1>${esc(U.title)}</h1>
        <div class="muted">강의마다 <b>강의 → 익히기 → 마인드맵</b> 순서로 진행해요. 앞 단계를 마쳐야 다음 단계가 열려요.</div>
        <div class="prog">${U.lectures.map((L, li) => `<div class="prow"><div class="pl">${esc(L.no)} ${esc(L.title)}<small>${esc(L.book)}</small></div><div class="pills">${
          STEPS.map((st, i) => st.li !== li ? '' : `<button class="pill ${i === view ? 'on' : shownDone(st) ? 'done' : i <= open ? 'open' : ''}" data-i="${i}">${shownDone(st) ? '✓ ' : ''}${esc(st.name)}</button>`).join('')
        }</div></div>`).join('')}</div>
      </div><div id="stage"></div></div>`;
    app.innerHTML = html;
    $$('.pill').forEach(b => b.onclick = () => { const i = +b.dataset.i; if (i <= firstOpen()) go(i); });
    $('#chName').onclick = () => { student = ''; store.set('cb_student', ''); stopPlayers(); start(); };
  }
  /* 영상을 끊지 않고 진도표 표시만 갱신 */
  function refreshPills() {
    const open = firstOpen();
    $$('.pill').forEach(b => { const i = +b.dataset.i, st = STEPS[i], d = shownDone(st);
      b.className = 'pill ' + (i === view ? 'on' : d ? 'done' : i <= open ? 'open' : '');
      b.textContent = (d ? '✓ ' : '') + st.name; });
  }
  function go(i) { stopPlayers(); view = i; shell(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function next() { const i = STEPS.findIndex((st, k) => k > view && !stepDone(st)); if (i === -1) { if (allDone()) return finish(); go(Math.min(view + 1, STEPS.length - 1)); } else go(i); }
  function nextLabel() { const k = view + 1; if (k >= STEPS.length) return 'Unit 마치기'; const st = STEPS[k]; return `다음: ${U.lectures[st.li].no} ${st.name} →`; }
  function render() {
    if (view >= STEPS.length) return renderDone();
    const st = STEPS[view];
    ({ watch: renderWatch, quiz: renderQuiz, mm: renderMM, sent: renderSent })[st.kind](st);
  }
  function finish() {
    if (!store.get('cb_done_' + pad(U.id), false)) { store.set('cb_done_' + pad(U.id), true); log('unit_complete', {}); }
    stopPlayers(); view = STEPS.length; shell(); renderDone(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderDone() {
    $('#stage').innerHTML = `<div class="card center"><div class="big">🎉</div><h2>Unit ${pad(U.id)}을 모두 마쳤어요</h2>
      <p class="sub">수고했어요.</p><div class="row" style="justify-content:center"><a class="btn ghost" href="index.html">목차로</a></div></div>`;
  }
  const doneBox = (title, body) => `<div class="panel ok"><h3>${title}</h3>${body || ''}</div><div class="row"><span class="grow"></span><button class="btn" id="goNext">${nextLabel()}</button></div>`;

  /* ---------- 강의 ---------- */
  function renderWatch(st) {
    const L = U.lectures[st.li], vs = vstate(L.id), box = $('#stage');
    box.innerHTML = `<div class="card">
      <h2>${esc(L.no)} 강의 · ${esc(L.title)}</h2>
      <p class="sub">강의를 ${Math.round(DONE_RATIO * 100)}% 이상 들으면 다음 단계가 열려요. 건너뛰거나 너무 빨리 감은 부분은 들은 것으로 치지 않아요.</p>
      ${L.note ? `<div class="notice">${esc(L.note)}</div>` : ''}
      <div class="player"><div id="yt"></div><div class="msg" id="ytMsg">강의를 불러오는 중…</div></div>
      <div class="bar" id="wbar"><i></i></div>
      <div class="row"><span class="grow note" id="wnote"></span><button class="btn" id="goNext" disabled>${nextLabel()}</button></div></div>`;
    const set = dec(vs.ranges);
    const upd = () => {
      const c = vs.dur ? Math.min(1, set.size / Math.floor(vs.dur)) : 0;
      $('#wbar i').style.width = Math.round(c * 100) + '%'; $('#wbar').classList.toggle('full', vs.done);
      $('#wnote').textContent = vs.done ? '✓ 강의를 다 들었어요' : vs.dur ? `들은 부분 ${Math.round(c * 100)}%` : '';
      $('#goNext').disabled = !vs.done;
    };
    upd();
    let tick = 0;
    const P = makePlayer('yt', L.id, ev => {
      { const d = ev.p.getDuration ? ev.p.getDuration() : 0; if (d > 0) vs.dur = d; }
      ev.secs.forEach(k => set.add(k));
      if (!ev.playing && !ev.secs.length) return;
      if (ev.jumped > 0) vs.seeks++;
      vs.maxRate = Math.max(vs.maxRate, ev.rate);
      if (ev.hidden) vs.hidden += ev.dt;
      vs.pos = ev.t; vs.ranges = enc(set);
      if (!vs.done && vs.dur && set.size / Math.floor(vs.dur) >= DONE_RATIO) {
        vs.done = true;
        log('lecture_done', { lecture: lecLabel(st.li), coverage: Math.round(set.size / Math.floor(vs.dur) * 100) + '%', seeks: vs.seeks, maxRate: vs.maxRate, hiddenSec: Math.round(vs.hidden) });
        save(); refreshPills();
      }
      if (++tick % 4 === 0) save();
      upd();
    });
    P.ready.then(p => { const m = $('#ytMsg'); m && m.remove(); if (!vs.done && vs.pos > 5) p.seekTo(Math.max(0, vs.pos - 3), true); })
      .catch(e => { $('#ytMsg').textContent = ytErrMsg(e); });
    $('#goNext').onclick = next;
  }

  /* ---------- 익히기 (객관식) ---------- */
  function renderQuiz(st) {
    const L = U.lectures[st.li], QS = L.quiz, box = $('#stage');
    const Z = S.quiz[st.li] = S.quiz[st.li] || { passed: false, attempts: [], cur: null, review: null };
    if (Z.passed) {
      const last = Z.attempts[Z.attempts.length - 1];
      box.innerHTML = `<div class="card"><h2>${esc(L.no)} 익히기</h2>${doneBox('통과했어요 ✓', `${QS.length}문항 모두 정답 · ${last.n}번째 응시`)}</div>`;
      $('#goNext').onclick = next; return;
    }
    if (Z.review) return renderReview(st);
    if (!Z.cur) { Z.cur = { order: shuffle(QS.map((_, i) => i)), ch: QS.map(q => shuffle(q.choices.map((_, i) => i))), picks: {} }; save(); }
    const C = Z.cur, n = Z.attempts.length + 1;
    box.innerHTML = `<div class="card"><h2>${esc(L.no)} 익히기 ${n > 1 ? `<span class="note">· ${n}번째 응시</span>` : ''}</h2>
      <p class="sub">${QS.length}문항을 <b>모두</b> 맞혀야 다음 단계로 넘어가요. 틀리면 관련 강의 구간을 다시 듣고 재응시합니다.</p>
      ${C.order.map((qi, k) => `<div class="q" data-q="${qi}"><div class="qt"><span class="qn">${k + 1}.</span>${esc(QS[qi].q)}</div>
        ${C.ch[qi].map((ci, j) => `<label class="opt ${C.picks[qi] === ci ? 'sel' : ''}"><input type="radio" name="q${qi}" value="${ci}" ${C.picks[qi] === ci ? 'checked' : ''}><span>${NUM[j]} ${esc(QS[qi].choices[ci])}</span></label>`).join('')}</div>`).join('')}
      <div class="row"><span class="grow note" id="qLeft"></span><button class="btn" id="qSubmit">제출하기</button></div></div>`;
    const upd = () => { const left = QS.length - Object.keys(C.picks).length; $('#qLeft').textContent = left ? `아직 ${left}문항을 고르지 않았어요` : ''; $('#qSubmit').disabled = left > 0; };
    $$('input[type=radio]', box).forEach(r => r.onchange = () => {
      const qi = +r.name.slice(1); C.picks[qi] = +r.value; save();
      $$(`.q[data-q="${qi}"] .opt`, box).forEach(o => o.classList.toggle('sel', $('input', o).checked)); upd();
    });
    upd();
    $('#qSubmit').onclick = () => {
      if (!confirm('제출할까요? 제출하면 답을 바꿀 수 없어요.')) return;
      const wrong = QS.map((_, i) => i).filter(i => C.picks[i] !== QS[i].answer);
      const att = { n, score: QS.length - wrong.length, total: QS.length, wrong: wrong.map(i => 'Q' + (i + 1)), at: Date.now() };
      Z.attempts.push(att); Z.cur = null;
      const passed = wrong.length === 0;
      log('quiz_attempt', { lecture: lecLabel(st.li), attempt: n, score: `${att.score}/${QS.length}`, result: passed ? '통과' : '미통과', wrong: att.wrong.join(', ') });
      if (passed) { Z.passed = true; save(); shell(); renderQuiz(st); return; }
      const segs = [];
      wrong.forEach(i => { const q = QS[i], key = q.from + '-' + q.to; if (!segs.some(s => s.key === key)) segs.push({ key, from: toSec(q.from), to: toSec(q.to), label: `${q.from} ~ ${q.to}`, watched: '', seeks: 0, maxRate: 1, hidden: 0 }); });
      segs.sort((a, b) => a.from - b.from);
      Z.review = { failedAt: Date.now(), segs }; save(); renderReview(st); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }
  function renderReview(st) {
    const L = U.lectures[st.li], Z = S.quiz[st.li], R = Z.review, last = Z.attempts[Z.attempts.length - 1], box = $('#stage');
    box.innerHTML = `<div class="card"><h2>${esc(L.no)} 익히기</h2>
      <div class="panel bad"><h3>아직 통과하지 못했어요 (${last.score}/${last.total})</h3>
        모두 맞혀야 통과예요. 정답은 알려주지 않아요. 아래 강의 구간을 다시 듣고 재응시하세요.
        <div class="segs">${R.segs.map((s, i) => `<div class="seg" data-i="${i}"><span class="st"><b>${esc(L.no)} 강의 ${esc(s.label)}</b><small>${fmt(s.to - s.from)} 분량</small></span><span class="cv"></span><button class="btn sm ghost" data-play="${i}">▶ 다시 듣기</button></div>`).join('')}</div></div>
      <div class="player"><div id="ytR"></div><div class="msg" id="rvMsg">위에서 ‘다시 듣기’를 누르세요</div></div>
      <div class="row"><span class="grow note">다시 들은 기록은 선생님께 함께 전달돼요.</span><button class="btn" id="qRetry">재응시하기</button></div></div>`;
    let cur = -1, set = null;
    const upd = () => $$('.seg', box).forEach(el => { const s = R.segs[+el.dataset.i], c = Math.min(1, dec(s.watched).size / Math.max(1, s.to - s.from)); $('.cv', el).textContent = c ? Math.round(c * 100) + '% 들음' : ''; el.classList.toggle('full', c >= 0.9); });
    upd();
    const P = makePlayer('ytR', L.id, ev => {
      if (cur < 0 || (!ev.playing && !ev.secs.length)) return; const s = R.segs[cur];
      if (ev.jumped > 0) s.seeks++;
      s.maxRate = Math.max(s.maxRate, ev.rate); if (ev.hidden) s.hidden += ev.dt;
      const add = ev.secs.filter(k => k >= s.from && k < s.to); if (add.length) { add.forEach(k => set.add(k)); s.watched = enc(set); save(); upd(); }
      if (ev.t >= s.to) ev.p.pauseVideo();
    });
    P.ready.catch(e => { $('#rvMsg').textContent = ytErrMsg(e); });
    $$('[data-play]', box).forEach(b => b.onclick = () => {
      cur = +b.dataset.play; const s = R.segs[cur]; set = dec(s.watched); P.reset();
      P.ready.then(p => { const m = $('#rvMsg'); m && m.remove(); p.loadVideoById({ videoId: L.id, startSeconds: s.from, endSeconds: s.to }); });
    });
    $('#qRetry').onclick = () => {
      const elapsed = (Date.now() - R.failedAt) / 1000, total = R.segs.reduce((a, s) => a + s.to - s.from, 0), flags = [];
      const detail = R.segs.map(s => {
        const c = dec(s.watched).size / Math.max(1, s.to - s.from);
        if (c < 0.8) flags.push(`${s.label} ${Math.round(c * 100)}%만 들음`);
        if (s.seeks >= 2) flags.push(`${s.label} 건너뛰기 ${s.seeks}회`);
        if (s.maxRate > 1.5) flags.push(`${s.label} ${s.maxRate}배속`);
        if (s.hidden > 20) flags.push(`${s.label} 다른 창 ${Math.round(s.hidden)}초`);
        return `${s.label}: ${Math.round(c * 100)}% (건너뛰기 ${s.seeks}, 최대 ${s.maxRate}배속, 다른 창 ${Math.round(s.hidden)}초)`;
      });
      if (elapsed < total * 0.8) flags.push(`재응시까지 ${fmt(elapsed)} (다시 들을 구간 합계 ${fmt(total)})`);
      if (flags.length && !confirm('아직 다 듣지 않은 구간이 있어요. 그래도 재응시할까요?\n(다시 들은 기록은 선생님께 전달돼요)')) return;
      log('quiz_retry', { lecture: lecLabel(st.li), attempt: Z.attempts.length + 1, elapsed: fmt(elapsed), segTotal: fmt(total), review: detail.join(' / '), flags: flags.join(' / ') });
      Z.review = null; save(); stopPlayers(); renderQuiz(st); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  /* ---------- 마인드맵 ---------- */
  function renderMM(st) {
    const L = U.lectures[st.li], M = L.mindmaps[st.mi], k = st.li + '-' + st.mi, box = $('#stage');
    const Z = S.mm[k] = S.mm[k] || { passed: false, attempts: 0 };
    if (Z.passed) { box.innerHTML = `<div class="card"><h2>${esc(L.no)} 마인드맵 · ${esc(M.title)}</h2>${doneBox('완성했어요 ✓', `${Z.attempts}번 만에 완성`)}</div>`; $('#goNext').onclick = next; return; }
    const slots = [];
    const node = (n, path) => {
      const hint = n.h ? `<span class="hint">${esc(n.h)}</span>` : '';
      let boxHtml;
      if (n.b) { const id = slots.length; slots.push({ id, answer: n.t, where: path.join(' > ') }); boxHtml = `<div class="mm-box slot" data-slot="${id}">${hint}<span class="sv">?</span></div>`; }
      else boxHtml = `<div class="mm-box">${hint}<span>${esc(n.t)}</span></div>`;
      const kids = n.c ? `<div class="mm-kids">${n.c.map(c => node(c, path.concat(n.b ? '(빈칸)' : n.t))).join('')}</div>` : '';
      return `<div class="mm-n">${boxHtml}${kids}</div>`;
    };
    const cols = M.branches.map(b => `<div class="mm-br">${node(b, [])}</div>`).join('');
    const cards = shuffle(slots.map(s => s.answer).concat(M.distractors || [])).map((w, i) => ({ i, w }));
    box.innerHTML = `<div class="card"><h2>${esc(L.no)} 마인드맵 · ${esc(M.title)}</h2>
      <p class="sub">아래 카드를 빈칸에 채워 마인드맵을 완성하세요. 카드를 누른 뒤 빈칸을 누르면 들어가요(끌어다 놓아도 돼요). 채운 칸을 다시 누르면 빠져요. 필요 없는 카드도 섞여 있어요.</p>
      <div class="mm-root"><span>${esc(M.root)}</span></div><div class="mm-cols">${cols}</div>
      <div class="bank" id="bank"></div><div id="mmMsg"></div>
      <div class="row"><span class="grow note" id="mmLeft"></span><button class="btn" id="mmCheck">확인하기</button></div></div>`;
    const placed = {}; let pick = null;
    const draw = () => {
      const used = new Set(Object.values(placed));
      $('#bank').innerHTML = cards.filter(c => !used.has(c.i)).map(c => `<button class="chip ${pick === c.i ? 'pick' : ''}" draggable="true" data-c="${c.i}">${esc(c.w)}</button>`).join('') || '<span class="note">카드를 모두 썼어요</span>';
      $$('.slot', box).forEach(el => { const ci = placed[+el.dataset.slot]; $('.sv', el).textContent = ci == null ? '?' : cards[ci].w; el.classList.toggle('filled', ci != null); });
      $$('.chip', box).forEach(ch => { ch.onclick = () => { pick = pick === +ch.dataset.c ? null : +ch.dataset.c; draw(); }; ch.ondragstart = e => e.dataTransfer.setData('text/plain', ch.dataset.c); });
      const left = slots.length - Object.keys(placed).length;
      $('#mmLeft').textContent = left ? `빈칸 ${left}개 남음` : '모든 빈칸을 채웠어요'; $('#mmCheck').disabled = left > 0;
    };
    $$('.slot', box).forEach(el => {
      const sid = +el.dataset.slot;
      el.onclick = () => { if (pick != null) { placed[sid] = pick; pick = null; } else if (placed[sid] != null) delete placed[sid]; draw(); };
      el.ondragover = e => { e.preventDefault(); el.classList.add('target'); };
      el.ondragleave = () => el.classList.remove('target');
      el.ondrop = e => { e.preventDefault(); el.classList.remove('target'); placed[sid] = +e.dataTransfer.getData('text/plain'); pick = null; draw(); };
    });
    draw();
    $('#mmCheck').onclick = () => {
      const wrong = slots.filter(s => cards[placed[s.id]].w !== s.answer);
      Z.attempts++;
      log('mindmap_attempt', { lecture: `${lecLabel(st.li)} · ${M.title}`, attempt: Z.attempts, score: `${slots.length - wrong.length}/${slots.length}`, result: wrong.length ? '미통과' : '통과', wrong: wrong.map(s => s.answer).join(', ') });
      if (!wrong.length) { Z.passed = true; save(); shell(); renderMM(st); return; }
      save();
      $('#mmMsg').innerHTML = `<div class="panel bad"><h3>${slots.length}칸 중 ${wrong.length}칸이 틀렸어요</h3>어느 칸인지는 알려주지 않아요. 다시 생각해서 고쳐 보세요.</div>`;
    };
  }

  /* ---------- 문장 익히기 (해석 쓰기) ---------- */
  function renderSent(st) {
    const L = U.lectures[st.li], T = L.sentences, box = $('#stage'), DK = KEY + '_sent_draft', draft = store.get(DK, {});
    if (S.sent.submitted) { box.innerHTML = `<div class="card"><h2>${esc(T.title)}</h2>${doneBox('제출했어요 ✓', '선생님이 채점한 뒤 알려줄 거예요.')}</div>`; $('#goNext').onclick = next; return; }
    box.innerHTML = `<div class="card"><h2>${esc(T.title)}</h2><p class="sub">${esc(T.intro)}</p>
      ${T.items.map(it => `<div class="sent"><div class="en"><b>${it.no}</b>${esc(it.en)}</div><textarea class="ans" data-no="${it.no}" placeholder="끊어 읽으며 해석을 쓰세요">${esc(draft[it.no] || '')}</textarea></div>`).join('')}
      <div class="row"><span class="grow note" id="sLeft"></span><button class="btn" id="sSubmit">제출하기</button></div></div>`;
    const upd = () => { const left = $$('textarea.ans', box).filter(t => t.value.trim().length < 2).length; $('#sLeft').textContent = left ? `아직 쓰지 않은 문장이 ${left}개 있어요 · 쓴 내용은 자동으로 임시 저장돼요` : '모두 썼어요'; $('#sSubmit').disabled = left > 0; };
    $$('textarea.ans', box).forEach(t => t.oninput = () => { draft[t.dataset.no] = t.value; store.set(DK, draft); upd(); });
    upd();
    $('#sSubmit').onclick = () => {
      if (!confirm('제출할까요? 제출하면 고칠 수 없어요.')) return;
      const text = [`[천일문 기본 Unit ${pad(U.id)}] ${T.title}`, `학생: ${student}`, `제출: ${new Date().toLocaleString('ko-KR')}`, '']
        .concat(T.items.map(it => `${it.no}. ${it.en}\n답: ${($(`textarea.ans[data-no="${it.no}"]`, box).value || '').trim()}`)).join('\n');
      log('reading_submit', { lecture: lecLabel(st.li), answersText: text });
      S.sent.submitted = true; save(); shell(); renderSent(st);
    };
  }

  /* ---------------- 시작 ---------------- */
  function start() {
    if (!student) {
      app.innerHTML = `<div class="wrap"><div class="top"><a href="index.html">← 목차</a></div>
        <div class="card" style="max-width:480px;margin:40px auto"><span class="badge">Unit ${pad(U.id)}</span>
        <h2 style="margin-top:10px">이름을 입력하세요</h2><p class="sub">공부한 기록이 이 이름으로 선생님께 전달돼요.</p>
        <input class="name" id="nm" placeholder="이름"><div class="row"><button class="btn" id="nmGo">시작하기</button></div></div></div>`;
      const ok = () => { const v = $('#nm').value.trim(); if (!v) return $('#nm').focus(); student = v; store.set('cb_student', v); log('start', {}); start(); };
      $('#nmGo').onclick = ok; $('#nm').onkeydown = e => { if (e.key === 'Enter') ok(); };
      return;
    }
    if (!S.opened) { S.opened = Date.now(); save(); log('unit_open', {}); }
    view = allDone() ? STEPS.length : firstOpen();
    shell(); render();
  }
  flush(); start();
})();
