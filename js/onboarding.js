// First-launch tutorial: a swipeable, full-screen slider (native scroll-snap, so it
// follows the finger exactly). Shown once per device; also after installing to the
// Home Screen, so the installed app opens with a proper introduction.
const KEY = 'spotplus.onboarded.v2';
export function shouldOnboard({standalone = false} = {}) {
  try {
    if (!localStorage.getItem(KEY)) return true;
    // First launch of the installed app gets the short version (no install slide).
    return standalone && !localStorage.getItem(KEY + '.installed');
  } catch { return false; }
}
function markDone(standalone) { try { localStorage.setItem(KEY, '1'); if (standalone) localStorage.setItem(KEY + '.installed', '1'); } catch { /* Private mode. */ } }

export function showOnboarding({icons: I, standalone = false, platform = 'other', canInstall = () => false, install = async () => {}, onConnect = () => {}, onTheme = () => {}, onRestore = () => {}, currentMode = 'dark'} = {}) {
  if (document.getElementById('onboard')) return;
  const slides = [
    {cls: 'obs-welcome', art: `<div class="ob-logo"><img src="icons/icon-512.png" alt=""></div>`, title: 'Your music.<br>Your way.', text: 'Spot+ is a free music player for your phone and computer. No ads, no account needed to start.'},
    {cls: 'obs-spotify', art: `<div class="ob-stack"><span style="--i:0"></span><span style="--i:1"></span><span style="--i:2"></span><b>${I.heartFill}</b></div>`, title: 'Bring your Spotify', text: 'Paste your Spotify profile and On Repeat links once. No login and nothing to install. Your top music, playlists and Rewind update by themselves.'},
    {cls: 'obs-canvas', art: `<div class="ob-phone"><div class="ob-loop"></div><div class="ob-bars"><i></i><i></i><i></i></div></div>`, title: 'Music that moves', text: 'Full-screen loops play behind your songs, like Spotify Canvas. They start instantly.'},
    {cls: 'obs-jam', art: `<div class="ob-jam"><span>C</span><span>S</span><span>R</span><em>${I.jam}</em></div>`, title: 'Jam together', text: 'Start a Jam and friends listen along in real time on their own phones. Everyone can add songs.'},
    {cls: 'obs-lyrics', art: `<div class="ob-lyric"><p>“is this the real life…”</p><div><b></b><span>Bohemian Rhapsody</span></div></div>`, title: 'Search by lyrics', text: 'Remember a line but not the name? Type it in Search and find the song.'},
    {cls: 'obs-theme', art: `<div class="ob-modes" role="group" aria-label="Appearance">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto'], ['clear', 'Clear']].map(([m, l]) => `<button data-ob-mode="${m}" aria-pressed="${currentMode === m}">${l}</button>`).join('')}</div><div class="ob-swatches">${[['pine', '#1b5e46'], ['m3-violet', '#6750a4'], ['m3-ocean', '#0061a4'], ['m3-coral', '#9c4146'], ['green', '#1db954']].map(([id, c]) => `<button data-ob-theme="${id}" style="--c:${c}" aria-label="${id} theme"></button>`).join('')}</div>`, title: 'Make it yours', text: 'Light, dark, clear, or automatic, and 19 color themes. Clear is transparent over a wallpaper. Change it anytime in Settings.'},
  ];
  if (!standalone) slides.push({cls: 'obs-install', art: `<div class="ob-home"><img src="icons/icon-192.png" alt=""><span>Spot+</span></div>`, title: 'Add to your Home Screen', text: platform === 'iphone' ? 'Tap <b>Share</b> <span class="ob-share" aria-hidden="true">⬆︎</span> in Safari, then <b>Add to Home Screen</b>. Spot+ opens full screen like an app.' : 'Install Spot+ for a full-screen app with its own icon. It works offline too.', install: true});
  slides.push({cls: 'obs-go', art: `<div class="ob-logo small"><img src="icons/icon-512.png" alt=""></div>`, title: 'You’re all set', text: 'Connect Spotify now, or start exploring. Everything stays on this device.', last: true});

  const root = document.createElement('div');
  root.id = 'onboard'; root.className = 'onboard'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Welcome to Spot+');
  root.innerHTML = `<button class="ob-skip" data-ob="skip">Skip</button>
  <div class="ob-track" tabindex="0">${slides.map((s, i) => `<section class="ob-slide ${s.cls}" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}"><div class="ob-art" aria-hidden="${!s.cls.includes('theme')}">${s.art}</div><h2>${s.title}</h2><p>${s.text}</p>${s.install ? `<button class="btn ob-install-btn" data-ob="install" ${canInstall() ? '' : 'hidden'}>Install Spot+</button>` : ''}${s.last ? `<div class="ob-final"><button class="btn primary big" data-ob="connect">Link Spotify</button><button class="btn big" data-ob="done">Start listening</button><button class="link ob-restore" data-ob="restore">Restore a Spot+ backup</button></div>` : ''}</section>`).join('')}</div>
  <footer class="ob-foot"><div class="ob-dots">${slides.map((_, i) => `<button data-ob-dot="${i}" aria-label="Go to slide ${i + 1}"></button>`).join('')}</div><button class="btn primary ob-next" data-ob="next">Next</button></footer>`;
  document.body.append(root);
  document.querySelector('.app')?.setAttribute('inert', '');
  const track = root.querySelector('.ob-track'), dots = [...root.querySelectorAll('[data-ob-dot]')], next = root.querySelector('.ob-next');
  let index = 0;
  const go = i => track.scrollTo({left: Math.max(0, Math.min(slides.length - 1, i)) * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  const update = () => {
    index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    dots.forEach((d, i) => d.setAttribute('aria-current', String(i === index)));
    root.dataset.slide = slides[index]?.cls || '';
    root.querySelectorAll('.ob-slide').forEach((s, i) => s.classList.toggle('active', i === index));
    const last = index === slides.length - 1;
    next.hidden = last; root.querySelector('.ob-skip').hidden = last;
  };
  track.addEventListener('scroll', () => requestAnimationFrame(update), {passive: true});
  const close = () => {
    markDone(standalone);
    root.classList.add('leaving');
    document.querySelector('.app')?.removeAttribute('inert');
    setTimeout(() => root.remove(), 280);
  };
  root.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.obDot) return go(+b.dataset.obDot);
    if (b.dataset.obMode || b.dataset.obTheme) {
      onTheme(b.dataset.obMode ? {themeMode: b.dataset.obMode} : {themePreset: b.dataset.obTheme, themeCustom: null});
      if (b.dataset.obMode) root.querySelectorAll('[data-ob-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      else root.querySelectorAll('[data-ob-theme]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      return;
    }
    const act = b.dataset.ob;
    if (act === 'next') go(index + 1);
    else if (act === 'skip') go(slides.length - 1);
    else if (act === 'install') { await install(); b.hidden = !canInstall(); }
    else if (act === 'connect') { close(); onConnect(); }
    else if (act === 'restore') { close(); onRestore(); }
    else if (act === 'done') close();
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'Escape') close();
  });
  update();
  requestAnimationFrame(() => { root.classList.add('open'); track.focus({preventScroll: true}); });
}
