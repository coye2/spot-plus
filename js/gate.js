// Startup gate: keeps the app blocked behind the maintenance screen unless maintenance
// mode is turned off or the current visitor matches an allowed owner session.
import * as maintenance from './maintenance.js';
import * as store from './store.js';
import { loadLinks } from './spotify-links.js';

function cleanAccessUrl() {
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const key of ['dev', 'owner', 'access', 'unlock']) {
      if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
    }
    if (/^#(?:dev|owner|access)=/i.test(url.hash)) { url.hash = ''; changed = true; }
    if (changed) history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}

const PURGE_SELECTORS = [
  '.app', '#np', '#ytDock', '#sheet', '#dlg', '#splash', '#sceneBg', '#toasts',
  '#welcomeBackup', '#profilePhotoInput', '#localFilesInput', '#spotifyImport',
  '#spotifyAccountImport', '#themeImport', '#bgUpload', '.lp', '.onboard',
];

function purgeAppNodes() {
  for (const sel of PURGE_SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  }
}

function lockMaintenanceDom(screen) {
  let locking = false;
  const enforce = () => {
    if (locking) return;
    locking = true;
    try {
      if (document.documentElement.dataset.maintenance !== '1') {
        document.documentElement.dataset.maintenance = '1';
      }
      purgeAppNodes();
      if (screen) {
        if (!screen.isConnected && document.body) document.body.prepend(screen);
        screen.hidden = false;
        screen.removeAttribute('style');
      }
    } finally {
      locking = false;
    }
  };
  enforce();
  const rootObserver = new MutationObserver(enforce);
  rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-maintenance', 'style', 'class'] });
  if (document.body) {
    rootObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
  }
}

function showMaintenance() {
  try { localStorage.removeItem(maintenance.DEV_ACCOUNT_CACHE_KEY); } catch { /* ignore */ }
  document.documentElement.dataset.maintenance = '1';
  document.title = 'Spot+ · We’ll return momentarily';
  purgeAppNodes();

  const screen = document.getElementById('maintenanceScreen');
  if (screen) {
    screen.hidden = false;
    lockMaintenanceDom(screen);
    const unlockWrap = document.getElementById('maintUnlockWrap');
    const brand = screen.querySelector('.maint-brand');
    const form = document.getElementById('maintAccessForm');
    const input = document.getElementById('maintAccessInput');
    const error = document.getElementById('maintAccessError');

    const revealUnlock = () => {
      if (!unlockWrap) return;
      unlockWrap.hidden = false;
      input?.focus?.();
    };
    const showStatus = (msg) => {
      if (!error) return;
      error.hidden = false;
      error.textContent = msg;
    };

    try {
      if (new URLSearchParams(location.search).get('unlock') === '1') {
        revealUnlock();
        cleanAccessUrl();
      }
    } catch { /* ignore */ }

    let taps = 0;
    let tapReset = 0;
    brand?.addEventListener('click', () => {
      taps++;
      clearTimeout(tapReset);
      tapReset = setTimeout(() => { taps = 0; }, 2200);
      if (taps >= 5) {
        taps = 0;
        revealUnlock();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && String(e.key || '').toLowerCase() === 'd') {
        e.preventDefault();
        revealUnlock();
      }
    });

    const cooldown = maintenance.getUnlockCooldown();
    if (cooldown > 0) {
      showStatus(`Too many attempts. Try again in ${cooldown}s.`);
    }

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const wait = maintenance.getUnlockCooldown();
      if (wait > 0) {
        showStatus(`Too many attempts. Try again in ${wait}s.`);
        return;
      }
      if (maintenance.unlockDeveloperAccess(input?.value)) {
        location.reload();
        return;
      }
      const nextWait = maintenance.getUnlockCooldown();
      showStatus(nextWait > 0
        ? `Too many attempts. Locked for ${nextWait}s.`
        : 'Access restricted during maintenance.');
      if (input) input.value = '';
    });
  }

  window.dispatchEvent(new Event('spotplus-ready'));
}

async function boot() {
  if (!maintenance.MAINTENANCE_MODE) {
    delete document.documentElement.dataset.maintenance;
    document.getElementById('maintenanceScreen')?.remove();
    await import('./app.js');
    return;
  }

  await store.ready();
  const links = await loadLinks().catch(() => null);
  const access = maintenance.canBypassMaintenance({
    spotifyAccount: store.getSpotifyAccount(),
    spotifyStats: store.getSpotifyStats(),
    links,
    search: location.search,
    hash: location.hash,
  });

  if (!access.allowed) {
    showMaintenance();
    return;
  }

  if (access.persistAccount && access.token) {
    try { localStorage.setItem(maintenance.DEV_ACCOUNT_CACHE_KEY, access.token); } catch { /* private mode */ }
  }
  if (access.stripParam) cleanAccessUrl();
  delete document.documentElement.dataset.maintenance;
  document.getElementById('maintenanceScreen')?.remove();
  await import('./app.js');
}

boot();
