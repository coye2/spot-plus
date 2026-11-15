// The document stays still; only the app's content panes scroll.
const root = document.documentElement;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
root.classList.toggle('ios-app', ios && (navigator.standalone || matchMedia('(display-mode: standalone)').matches));
// The app fills the screen with plain CSS (body is fixed to the viewport). Sizing it
// from visualViewport left a black strip under the tab bar on iPhone whenever that
// reading came back short (keyboard, Home Screen launch), so it is no longer used.
for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, event => event.preventDefault(), { passive: false });
document.addEventListener('touchmove', event => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });

const splash = document.getElementById('splash');
const hideSplash = () => { splash?.classList.add('leaving'); setTimeout(() => splash?.remove(), 220); };
// Never keep a listener waiting for catalog requests or an unavailable module.
const deadline = setTimeout(hideSplash, 850);
window.addEventListener('spotplus-ready', () => { clearTimeout(deadline); setTimeout(hideSplash, 140); }, { once: true });

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
  if (event.touches.length !== 1 || event.target.closest('input,textarea,select,.shelf,.chips,.view-toolbar,.spotify-embed')) return;
  content.style.transition = '';
  gesture = { x: event.touches[0].clientX, y: event.touches[0].clientY, edge: 0 };
}, { passive: true });
pane?.addEventListener('touchmove', event => {
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
