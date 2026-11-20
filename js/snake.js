// Snake, Spotify style: the snake is made of your songs' covers. The head is the song playing now, every bite is
// the next song in your queue, and the snake grows one cover at a time. Swipe, use the arrows or the d-pad.
// When the game ends you see the songs you ate and can play them as a queue.

const BEST = 'spotplus.snakeBest';
const DIRS = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};
const OPPOSITE = {up: 'down', down: 'up', left: 'right', right: 'left'};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** Pure game state, so the rules can be tested without a screen. The body reads in queue order: the head is the
 * song playing now, then the next songs; every song you eat joins at the tail, the way a real snake grows. */
export function createGame({cols = 15, rows = 15, songs = [], random = Math.random} = {}) {
  const mid = Math.floor(rows / 2), n = songs.length;
  const g = {cols, rows, songs, random, dir: 'right', queued: [], over: false, won: false, eaten: 0,
    snake: [{x: 3, y: mid, song: n ? 0 : -1}, {x: 2, y: mid, song: n > 1 ? 1 : -1}, {x: 1, y: mid, song: n > 2 ? 2 : -1}], next: Math.min(3, n), food: null, prev: null};
  placeFood(g);
  return g;
}
function placeFood(g) {
  const taken = new Set(g.snake.map((s) => s.x + ',' + s.y)), free = [];
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (!taken.has(x + ',' + y)) free.push({x, y});
  if (!free.length) { g.food = null; g.over = g.won = true; return; }
  g.food = {...free[Math.floor(g.random() * free.length)], song: g.songs.length ? g.next % g.songs.length : -1};
}
/** Queue a turn (up to two ahead, so quick double swipes both count). Reversing into yourself is ignored. */
export function turn(g, dir) {
  if (!DIRS[dir]) return;
  const last = g.queued.at(-1) || g.dir;
  if (dir === last || dir === OPPOSITE[last] || g.queued.length >= 2) return;
  g.queued.push(dir);
}
/** One move. Returns 'ate', 'over' or 'moved'. g.prev keeps where each piece was, for smooth drawing. */
export function step(g) {
  if (g.over) return 'over';
  if (g.queued.length) g.dir = g.queued.shift();
  const [dx, dy] = DIRS[g.dir], head = g.snake[0];
  const x = head.x + dx, y = head.y + dy;
  const eating = g.food && x === g.food.x && y === g.food.y;
  // The tail moves away this turn unless the snake grows, so the head may take its place.
  const body = eating ? g.snake : g.snake.slice(0, -1);
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows || body.some((s) => s.x === x && s.y === y)) { g.over = true; return 'over'; }
  g.prev = g.snake.map((s) => ({x: s.x, y: s.y}));
  // Every piece slides into the place of the one ahead of it and keeps its own song.
  const songs = g.snake.map((s) => s.song);
  const places = [{x, y}, ...g.prev.slice(0, eating ? g.prev.length : -1)];
  if (eating) songs.push(g.food.song);
  g.snake = places.map((p, i) => ({...p, song: songs[i]}));
  if (eating) { g.eaten++; g.next++; placeFood(g); return 'ate'; }
  return 'moved';
}
/** Gets quicker as the snake grows: 170 ms per move at the start, down to 75. */
export const speed = (eaten) => Math.max(75, 170 - eaten * 4);

/** Opens the game full screen. songs: [{title, artist, cover}], first is the song playing now. */
export function open({songs = [], onPlay, accent = '#1ed760'} = {}) {
  const list = songs.filter((s) => s && s.title).slice(0, 300);
  const d = document.createElement('dialog');
  d.className = 'snake';
  d.innerHTML = `<div class="snake-top"><button class="snake-x" aria-label="Close Snake">✕</button><div class="snake-score"><b>0</b><span>songs eaten</span></div><div class="snake-best">Best <b>${Number(localStorage.getItem(BEST)) || 0}</b></div></div>
    <div class="snake-board"><canvas aria-label="Snake game board"></canvas><div class="snake-overlay"></div></div>
    <div class="snake-now"><img alt=""><div><b></b><span></span></div></div>
    <div class="snake-pad" aria-label="Direction buttons"><button type="button" data-d="up" aria-label="Up"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 6l7 10H5z" transform="rotate(0 12 12)"/></svg></button><button type="button" data-d="left" aria-label="Left"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 6l7 10H5z" transform="rotate(270 12 12)"/></svg></button><button type="button" data-d="down" aria-label="Down"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 6l7 10H5z" transform="rotate(180 12 12)"/></svg></button><button type="button" data-d="right" aria-label="Right"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 6l7 10H5z" transform="rotate(90 12 12)"/></svg></button></div>`;
  document.body.append(d);
  const canvas = d.querySelector('canvas'), ctx = canvas.getContext('2d'), overlay = d.querySelector('.snake-overlay');
  const images = new Map();
  const imageFor = (i) => {
    const song = list[i];
    if (!song?.cover) return null;
    if (!images.has(i)) { const im = new Image(); im.decoding = 'async'; im.src = song.cover; images.set(i, im); }
    const im = images.get(i);
    return im.complete && im.naturalWidth ? im : null;
  };
  list.slice(0, 12).forEach((_, i) => imageFor(i));

  let g, timer = 0, last = 0, running = false, raf = 0, cell = 20;
  const best = () => Number(localStorage.getItem(BEST)) || 0;
  const size = () => {
    const box = d.querySelector('.snake-board').getBoundingClientRect();
    const side = Math.floor(Math.min(box.width, box.height));
    cell = Math.floor(side / 15);
    const px = cell * 15, ratio = Math.min(3, devicePixelRatio || 1);
    canvas.width = px * ratio; canvas.height = px * ratio;
    canvas.style.width = canvas.style.height = px + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  };
  // Pieces are drawn between squares: each slides from where it was to where it is over one move, so the snake
  // glides instead of jumping. t goes 0 → 1 across each move; an eaten song pops in at the tail.
  const tile = (x, y, songIndex, scale = 1, glow = false) => {
    const pad = cell * (1 - scale) / 2 + 1, s = cell * scale - 2, r = Math.max(3, cell * 0.2);
    const px = x * cell + pad, py = y * cell + pad;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(px, py, s, s, r); ctx.clip();
    const im = songIndex >= 0 ? imageFor(songIndex) : null;
    if (im) ctx.drawImage(im, px, py, s, s);
    else { ctx.fillStyle = accent; ctx.fillRect(px, py, s, s); }
    ctx.restore();
    if (glow) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(px, py, s, s, r); ctx.stroke(); }
  };
  const ease = (t) => t * t * (3 - 2 * t);
  let bite = 0;
  function draw(now = performance.now()) {
    if (!g) return;
    const px = cell * 15;
    ctx.clearRect(0, 0, px, px);
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) { ctx.fillStyle = (x + y) % 2 ? '#ffffff08' : '#ffffff03'; ctx.fillRect(x * cell, y * cell, cell, cell); }
    const t = running && g.prev ? Math.min(1, (now - last) / speed(g.eaten)) : 1;
    const at = (i) => { const s = g.snake[i], p = g.prev?.[i] || s; return {x: p.x + (s.x - p.x) * t, y: p.y + (s.y - p.y) * t}; };
    if (g.food) tile(g.food.x, g.food.y, g.food.song, 0.8 + Math.sin(now / 200) * 0.07, true);
    const n = g.snake.length, pop = Math.max(0, 1 - (now - bite) / 260);
    for (let i = n - 1; i >= 0; i--) {
      const p = at(i), grow = i === n - 1 && pop > 0 && !g.prev?.[i] ? ease(1 - pop) : 1;
      tile(p.x, p.y, g.snake[i].song, (i === 0 ? 1 + pop * 0.12 : 0.9) * grow);
    }
    // Eyes on the head, looking where it's going.
    const h = at(0), [dx, dy] = DIRS[g.queued[0] && t > 0.85 ? g.queued[0] : g.dir], cx = h.x * cell + cell / 2, cy = h.y * cell + cell / 2;
    for (const side of [-1, 1]) {
      const ex = cx + dx * cell * 0.18 + dy * side * cell * 0.2, ey = cy + dy * cell * 0.18 - dx * side * cell * 0.2;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, cell * 0.12, 0, 7); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ex + dx * cell * 0.04, ey + dy * cell * 0.04, cell * 0.06, 0, 7); ctx.fill();
    }
  }
  const showSong = (i) => {
    const song = list[i], row = d.querySelector('.snake-now');
    if (!song) { row.hidden = true; return; }
    row.hidden = false;
    row.querySelector('img').src = song.cover || '';
    row.querySelector('b').textContent = song.title;
    row.querySelector('span').textContent = song.artist || '';
  };
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (running && now - last >= speed(g.eaten)) {
      // Keep an exact rhythm (no drift); after a long gap (tab hidden), restart the clock instead of rushing.
      last = now - last > speed(g.eaten) * 3 ? now : last + speed(g.eaten);
      const r = step(g);
      if (r === 'ate') {
        bite = now;
        d.querySelector('.snake-score b').textContent = g.eaten;
        showSong(g.snake.at(-1).song);
        imageFor((g.next + 2) % Math.max(1, list.length));
        navigator.vibrate?.(12);
      }
      if (r === 'over') end();
    }
    draw(now);
  };
  const start = () => {
    g = createGame({songs: list});
    if (globalThis.__snakeTest) globalThis.__snakeGame = g;
    d.querySelector('.snake-score b').textContent = '0';
    showSong(0);
    overlay.hidden = true;
    running = true; last = performance.now();
  };
  const end = () => {
    running = false;
    navigator.vibrate?.([30, 40, 30]);
    const record = g.eaten > best();
    if (record) { try { localStorage.setItem(BEST, String(g.eaten)); } catch { /* storage blocked */ } d.querySelector('.snake-best b').textContent = g.eaten; }
    const ate = [...new Set(g.snake.map((s) => s.song).filter((i) => i >= 0))].map((i) => list[i]).filter(Boolean);
    overlay.hidden = false;
    overlay.innerHTML = `<h2>${g.won ? 'You filled the board!' : record ? 'New best!' : 'Game over'}</h2><p>You ate ${g.eaten} song${g.eaten === 1 ? '' : 's'}.</p>
      ${ate.length > 1 ? `<div class="snake-ate">${ate.slice(0, 12).map((s) => `<img src="${esc(s.cover || '')}" alt="${esc(s.title)}" title="${esc(s.title)} · ${esc(s.artist)}">`).join('')}</div>` : ''}
      <div class="snake-buttons"><button class="btn primary" data-a="again">Play again</button>${ate.length > 1 && onPlay ? '<button class="btn" data-a="play">Play these songs</button>' : ''}</div>`;
    overlay.querySelector('[data-a="again"]').onclick = start;
    const play = overlay.querySelector('[data-a="play"]');
    if (play) play.onclick = () => { onPlay(ate); close(); };
  };
  const intro = () => {
    g = createGame({songs: list});
    showSong(0);
    overlay.hidden = false;
    overlay.innerHTML = `<h2>Snake</h2><p>Eat the next song in your queue: it joins your tail. Don’t hit the walls or yourself.</p><p class="snake-hint">${matchMedia('(pointer: coarse)').matches ? 'Swipe anywhere or tap the arrows to turn.' : 'Use the arrow keys or WASD. Space pauses.'}</p><div class="snake-buttons"><button class="btn primary" data-a="go">Start</button></div>`;
    overlay.querySelector('[data-a="go"]').onclick = start;
  };
  const pause = () => {
    if (!running || !g || g.over) return;
    running = false; overlay.hidden = false;
    overlay.innerHTML = `<h2>Paused</h2><div class="snake-buttons"><button class="btn primary" data-a="go">Keep going</button></div>`;
    overlay.querySelector('[data-a="go"]').onclick = () => { overlay.hidden = true; running = true; last = performance.now(); };
  };
  const keys = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right'};
  const onKey = (e) => {
    if (keys[e.key]) { e.preventDefault(); if (!running && g && !g.over && overlay.hidden === false && overlay.querySelector('[data-a="go"]')) overlay.querySelector('[data-a="go"]').click(); if (g) turn(g, keys[e.key]); }
    else if (e.key === ' ') { e.preventDefault(); running ? pause() : overlay.querySelector('[data-a="go"],[data-a="again"]')?.click(); }
  };
  // Touch: swipe anywhere on the screen (not only the board). On iPhone, touch events are handled directly and
  // their default stopped, so a press never starts text selection or the copy menu and turns land instantly.
  let touch = null, lastTouch = 0;
  const press = (dir, e) => { e.preventDefault(); if (g && running) turn(g, dir); else if (g && !g.over) overlay.querySelector('[data-a="go"]')?.click(); };
  d.addEventListener('touchstart', (e) => {
    lastTouch = Date.now();
    const pad = e.target.closest?.('.snake-pad button');
    if (pad) { press(pad.dataset.d, e); pad.classList.add('down'); setTimeout(() => pad.classList.remove('down'), 140); touch = null; return; }
    if (e.target.closest?.('button, a')) return;
    touch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
    e.preventDefault();
  }, {passive: false});
  d.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!touch || !g) return;
    const dx = e.touches[0].clientX - touch.x, dy = e.touches[0].clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    turn(g, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    touch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
  }, {passive: false});
  d.addEventListener('touchend', () => { touch = null; });
  // Mouse or pen on the buttons (ignored right after a touch, which already turned).
  d.querySelectorAll('.snake-pad button').forEach((b) => b.addEventListener('mousedown', (e) => { if (Date.now() - lastTouch > 600) press(b.dataset.d, e); }));
  d.addEventListener('contextmenu', (e) => e.preventDefault());
  d.addEventListener('selectstart', (e) => e.preventDefault());
  const onHide = () => { if (document.hidden) pause(); };
  const close = () => { cancelAnimationFrame(raf); clearTimeout(timer); removeEventListener('keydown', onKey); removeEventListener('resize', size); document.removeEventListener('visibilitychange', onHide); d.close(); d.remove(); };
  d.querySelector('.snake-x').onclick = close;
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  addEventListener('keydown', onKey);
  addEventListener('resize', size);
  document.addEventListener('visibilitychange', onHide);
  d.showModal();
  intro();
  requestAnimationFrame(() => { size(); raf = requestAnimationFrame(loop); });
  return close;
}
