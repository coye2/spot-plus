// The document stays still; only the app's content panes scroll.
const root = document.documentElement;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
root.classList.toggle('ios-app', ios && (navigator.standalone || matchMedia('(display-mode: standalone)').matches));
// The app fills the screen with plain CSS (body is fixed to the viewport). Sizing it
// from visualViewport left a black strip under the tab bar on iPhone whenever that
// reading came back short (keyboard, Home Screen launch), so it is no longer used.
// iOS 26 bug: Home Screen apps can get a viewport shorter than the screen, leaving a
// gap under the tab bar. Detect it (ignoring the keyboard) so CSS can drop the extra
// bottom inset that would double it.
function fitIOS() {
  if (!root.classList.contains('ios-app') || /input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
  const portrait = window.innerHeight >= window.innerWidth;
  const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  root.classList.toggle('ios-short-viewport', screenHeight - window.innerHeight >= 20);
}
fitIOS();
window.addEventListener('resize', fitIOS);
window.addEventListener('orientationchange', () => setTimeout(fitIOS, 350));
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => event.preventDefault(), { passive: false });
document.addEventListener('touchmove', event => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });

const splash = document.getElementById('splash');
const hideSplash = () => {
  if (root.dataset.maintenance === 'checking') {
    root.dataset.maintenance = '1';
    const maint = document.getElementById('maintenanceScreen');
    if (maint) maint.hidden = false;
  }
  splash?.classList.add('leaving');
  setTimeout(() => splash?.remove(), 220);
};
// Never keep a listener waiting for catalog requests or an unavailable module.
// Show the splash for at least ~1.6s so it reads as a proper launch screen, but never longer than 3s.
const shownAt = performance.now(), MIN_SPLASH = 1600;
const deadline = setTimeout(hideSplash, 3000);
window.addEventListener('spotplus-ready', () => { clearTimeout(deadline); setTimeout(hideSplash, Math.max(140, MIN_SPLASH - (performance.now() - shownAt))); }, { once: true });

const pane = document.getElementById('main');
const content = document.getElementById('view');
let gesture = null;
function settle() {
  if (!content || !gesture) return;
  content.style.transition = 'transform 440ms cubic-bezier(.18,.85,.2,1)';
  content.style.transform = '';
  gesture = null;
}
pane?.addEventListener('touchstart', event => {
  // The wallpaper database is its own scroller. This rubber-band calls preventDefault
  // on the whole pane, which stops that list from moving and drags the page instead.
  if (document.body.dataset.page === 'backgrounds' || event.target.closest('#bgList,.bg-table-wrap')) return;
  if (event.touches.length !== 1 || event.target.closest('input,textarea,select,.shelf,.chips,.view-toolbar,.spotify-embed')) return;
  content.style.transition = '';
  gesture = { x: event.touches[0].clientX, y: event.touches[0].clientY, edge: 0 };
}, { passive: true });
pane?.addEventListener('touchmove', event => {
  if (document.body.dataset.page === 'backgrounds' || event.target.closest('#bgList,.bg-table-wrap')) {
    gesture = null;
    return;
  }
  if (!gesture || event.touches.length !== 1) return;
  const dy = event.touches[0].clientY - gesture.y, dx = event.touches[0].clientX - gesture.x;
  if (Math.abs(dx) > Math.abs(dy)) return;
  const top = pane.scrollTop <= 0, bottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
  if ((top && dy > 0) || (bottom && dy < 0) || gesture.edge) {
    if (!gesture.edge) { gesture.edge = Math.sign(dy); gesture.y = event.touches[0].clientY; }
    event.preventDefault();
    const distance = event.touches[0].clientY - gesture.y;
    const reduced = document.body.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const offset = Math.sign(distance) === gesture.edge && !reduced ? Math.sign(distance) * 56 * (1 - Math.exp(-Math.abs(distance) / 180)) : 0;
    content.style.transform = `translate3d(0,${offset}px,0)`;
  }
}, { passive: false });
pane?.addEventListener('touchend', settle, { passive: true });
pane?.addEventListener('touchcancel', settle, { passive: true });
window.addEventListener('hashchange', settle);
