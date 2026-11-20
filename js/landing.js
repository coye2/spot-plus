// Spot+ download page: one Install button that does the right thing on every device,
// plus "Continue in browser". Shown to first-time visitors in a browser tab only.
const KEY = 'spotplus.landing';
const APP_URL = 'https://coye2.github.io/spot-plus/';

/** True when a first-time browser visitor should see the download page. */
export function shouldShowLanding({standalone = false, hash = '', storage = globalThis.localStorage} = {}) {
  if (standalone || /^#\/(jam\/|spotify-account|linked\/|spotify\/)/.test(hash)) return false;
  try { return !storage.getItem(KEY) && !storage.getItem('spotplus.onboarded.v2'); } catch { return false; }
}

/** Work out the best way to install on this device. */
export function installPlan(ua = '', {touchPoints = 0, hasPrompt = false, standalone = false} = {}) {
  if (standalone) return {kind: 'installed', device: 'app'};
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const android = /Android/.test(ua);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|musical_ly|TikTok|Twitter|LinkedInApp|Pinterest|GSA\//.test(ua);
  const device = ios ? (/iPad/.test(ua) || /Macintosh/.test(ua) ? 'iPad' : 'iPhone') : android ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : 'computer';
  if (inApp) return {kind: 'inapp', device, ios, android};
  if (hasPrompt) return {kind: 'prompt', device};
  if (ios) {
    const browser = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : 'Safari';
    return {kind: 'ios', device, browser};
  }
  if (android) return {kind: 'android-menu', device, browser: /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox/.test(ua) ? 'Firefox' : 'browser'};
  if (/Firefox\//.test(ua)) return {kind: 'firefox-desktop', device};
  if (/Macintosh/.test(ua) && /Version\/[\d.]+ Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return {kind: 'mac-safari', device};
  return {kind: 'chromium-wait', device};
}

export const installLabel = plan => ({
  installed: 'Open Spot+', inapp: 'Open in ' + (plan.ios ? 'Safari' : 'your browser'),
  'firefox-desktop': 'How to install',
}[plan.kind] || `Install on ${plan.device === 'computer' ? 'this computer' : plan.device}`);

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 7.8 6.8l1.4 1.4L11 6.4V15h2V6.4l1.8 1.8 1.4-1.4zM5 10v11h14V10h-3v2h1v7H7v-7h1v-2z"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h14V5zm6 3h2v3h3v2h-3v3h-2v-3H8v-2h3z"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

function guide(plan) {
  const step = (icon, html) => `<li><span class="lp-step-icon">${icon}</span><span>${html}</span></li>`;
  switch (plan.kind) {
    case 'ios': return {
      title: `Add Spot+ to your ${plan.device}`,
      steps: [
        step(SHARE, plan.browser === 'Safari' ? 'Tap <b>Share</b> in Safari’s toolbar. On iOS 26, tap <b>⋯</b> first, then <b>Share</b>.' : `Tap <b>Share</b> in ${plan.browser}’s address bar.`),
        step(PLUS, 'Scroll down and tap <b>Add to Home Screen</b>.'),
        step(CHECK, 'Tap <b>Add</b>. Spot+ appears on your Home Screen like any app.')],
      pointer: plan.device === 'iPhone' && plan.browser === 'Safari' ? 'down' : 'up'};
    case 'android-menu': return {
      title: 'Add Spot+ to your Home screen',
      steps: [step(DOTS, `Open ${plan.browser === 'browser' ? 'your browser’s' : plan.browser + '’s'} <b>menu</b> (⋮ or ≡).`), step(PLUS, 'Tap <b>Install app</b> or <b>Add to Home screen</b>.'), step(CHECK, 'Confirm. Spot+ opens like a regular app.')], pointer: 'up'};
    case 'mac-safari': return {
      title: 'Add Spot+ to your Dock',
      steps: [step(SHARE, 'In the menu bar, choose <b>File</b>, or click <b>Share</b> in the toolbar.'), step(PLUS, 'Choose <b>Add to Dock</b>.'), step(CHECK, 'Click <b>Add</b>. Spot+ opens in its own window.')], pointer: 'up'};
    case 'firefox-desktop': return {
      title: 'Install Spot+ with Chrome or Edge',
      steps: [step(DOTS, 'Firefox can’t install web apps on computers yet.'), step(PLUS, 'Open this page in <b>Chrome</b> or <b>Edge</b> and click Install.'), step(CHECK, 'Or just continue here — everything works in the browser too.')], pointer: ''};
    default: return {
      title: 'Install Spot+',
      steps: [step(PLUS, 'Click the <b>install icon</b> at the right end of the address bar, or open the browser menu and choose <b>Install Spot+</b>.'), step(CHECK, 'Spot+ opens in its own window and gets a Start menu or Dock icon.')], pointer: 'up'};
  }
}

/** Render the page. Resolves when the person continues into the app. */
export function showLanding({qr = () => '', getPrompt = () => null, usedPrompt = () => {}, standalone = false, onShow = () => {}} = {}) {
  return new Promise(resolve => {
    let plan = installPlan(navigator.userAgent, {touchPoints: navigator.maxTouchPoints || 0, hasPrompt: !!getPrompt(), standalone});
    const desktop = !/iPhone|iPad|Android/.test(plan.device) && plan.device !== 'app';
    const el = document.createElement('div');
    el.className = 'lp';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Get Spot+');
    el.innerHTML = `<div class="lp-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="lp-inner">
      <header class="lp-top"><img src="icons/icon-192.png" alt="" width="36" height="36"><b>Spot+</b><button class="lp-skip" data-lp="web">Use in browser</button></header>
      <section class="lp-hero">
        <div class="lp-copy">
          <p class="lp-kicker">Free · No account · Every device</p>
          <h1>All your music.<br><span>One tap away.</span></h1>
          <p class="lp-sub">Spotify’s playlists, your Rewind stats anytime, Jams with friends and an AI DJ — in one free app that installs in seconds.</p>
          <div class="lp-actions">
            <button class="lp-install" data-lp="install"><span class="lp-install-glow" aria-hidden="true"></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16 6.3 10.3l1.4-1.4L11 12.2zM5 18h14v2H5z"/></svg><span class="lp-install-label">${esc(installLabel(plan))}</span></button>
            <button class="lp-web" data-lp="web">Continue in browser</button>
          </div>
          <p class="lp-live" data-live-box hidden><i></i><b data-live="listening">0</b> listening right now · <b data-live="installs">0</b> installs · <b data-live="rating">–</b>★ rating</p>
          <p class="lp-fine">No app store, no download wait. Under 2 MB, works offline, updates itself.</p>
          <ul class="lp-feats"><li>🎧 Full player</li><li>📊 Rewind</li><li>👥 Jam</li><li>🎙️ AI DJ</li><li>🎨 19 themes</li></ul>
        </div>
        <div class="lp-stage" aria-hidden="true">
          <div class="lp-phones">
            <figure class="lp-phone p1"><img src="icons/shot-home.webp" alt=""></figure>
            <figure class="lp-phone p2"><img src="icons/shot-coll.webp" alt=""></figure>
            <figure class="lp-phone p3"><img src="icons/shot-jam.webp" alt=""></figure>
          </div>
        </div>
      </section>
      ${desktop ? `<section class="lp-qr"><div class="lp-qr-code">${qr(APP_URL)}</div><div><b>On your phone?</b><p>Point your camera here to get Spot+ on iPhone or Android.</p></div></section>` : ''}
    </div>
    <div class="lp-sheet" hidden><div class="lp-sheet-card" role="dialog" aria-modal="true" aria-labelledby="lpGuideTitle"><button class="lp-sheet-close" data-lp="close" aria-label="Close">×</button><h2 id="lpGuideTitle"></h2><ol class="lp-steps"></ol><button class="lp-web lp-sheet-web" data-lp="web">Continue in browser for now</button></div><div class="lp-pointer" aria-hidden="true"></div></div>
    <div class="lp-done" hidden><div class="lp-done-card"><div class="lp-done-check">${CHECK}</div><h2>Spot+ is installed</h2><p>Open it from your ${plan.device === 'iPhone' || plan.device === 'Android' || plan.device === 'iPad' ? 'Home Screen' : 'apps, Start menu or Dock'}. It’s ready offline.</p><button class="lp-web" data-lp="web">Keep using it here</button></div></div>`;
    document.body.append(el);
    document.documentElement.classList.add('lp-open');
    requestAnimationFrame(() => el.classList.add('in'));
    onShow(el);

    // Parallax: phones follow the pointer or the phone's tilt.
    const phones = el.querySelector('.lp-phones');
    const tilt = (x, y) => phones.style.setProperty('transform', `rotateY(${x * 14}deg) rotateX(${-y * 10}deg)`);
    const onMove = e => tilt(e.clientX / innerWidth - .5, e.clientY / innerHeight - .5);
    const onTilt = e => { if (e.gamma != null) tilt(Math.max(-1, Math.min(1, e.gamma / 30)) / 2, Math.max(-1, Math.min(1, (e.beta - 45) / 30)) / 2); };
    addEventListener('pointermove', onMove, {passive: true});
    addEventListener('deviceorientation', onTilt, {passive: true});

    const label = el.querySelector('.lp-install-label');
    const refresh = () => { plan = installPlan(navigator.userAgent, {touchPoints: navigator.maxTouchPoints || 0, hasPrompt: !!getPrompt(), standalone}); label.textContent = installLabel(plan); };
    const onPrompt = () => setTimeout(refresh, 0);
    addEventListener('beforeinstallprompt', onPrompt);
    const done = () => { el.querySelector('.lp-sheet').hidden = true; el.querySelector('.lp-done').hidden = false; };
    addEventListener('appinstalled', done);

    const sheet = el.querySelector('.lp-sheet');
    const openGuide = () => {
      const g = guide(plan);
      sheet.querySelector('h2').textContent = g.title;
      sheet.querySelector('.lp-steps').innerHTML = g.steps.join('');
      sheet.querySelector('.lp-pointer').dataset.dir = g.pointer;
      sheet.hidden = false;
    };
    const finish = () => {
      try { localStorage.setItem(KEY, 'web'); } catch { /* Private mode. */ }
      removeEventListener('pointermove', onMove); removeEventListener('deviceorientation', onTilt);
      removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', done);
      el.classList.remove('in'); el.classList.add('out');
      document.documentElement.classList.remove('lp-open', 'landing');
      setTimeout(() => { el.remove(); resolve(); }, 450);
    };
    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-lp]')?.dataset.lp;
      if (act === 'web') finish();
      else if (act === 'close') sheet.hidden = true;
      else if (act === 'install') {
        if (plan.kind === 'installed') return finish();
        if (plan.kind === 'inapp') {
          if (plan.ios) location.href = 'x-safari-' + APP_URL;
          else if (plan.android) location.href = 'intent://' + APP_URL.replace(/^https:\/\//, '') + '#Intent;scheme=https;end';
          else openGuide();
          return;
        }
        if (plan.kind === 'chromium-wait') { // Chrome/Edge can fire the install event a moment late.
          label.textContent = 'Getting ready…';
          for (let i = 0; i < 15 && !getPrompt(); i++) await new Promise(r => setTimeout(r, 100));
          refresh();
        }
        const prompt = getPrompt();
        if (prompt) {
          prompt.prompt();
          usedPrompt();
          const choice = await prompt.userChoice.catch(() => null);
          if (choice?.outcome === 'accepted') done();
          refresh();
          return;
        }
        openGuide();
      }
    });
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.hidden = true; });
  });
}
