// Startup gate: keeps the app blocked behind the maintenance screen unless maintenance
// mode is turned off or the current visitor matches an allowed developer/coye-9 session.
import * as maintenance from './maintenance.js';
import * as store from './store.js';
import { loadLinks } from './spotify-links.js';

function cleanAccessUrl() {
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const key of ['dev', 'owner', 'access']) {
      if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
    }
    if (/^#(?:dev|owner|access)=/i.test(url.hash)) { url.hash = ''; changed = true; }
    if (changed) history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}

function showMaintenance() {
  try { localStorage.removeItem(maintenance.DEV_ACCOUNT_CACHE_KEY); } catch { /* ignore */ }
  document.documentElement.dataset.maintenance = '1';
  document.title = 'Spot+ · We’ll return momentarily';

  for (const sel of ['.app', '#np', '#ytDock', '#sheet', '#dlg', '#splash', '#sceneBg', '#toasts']) {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  }

  const screen = document.getElementById('maintenanceScreen');
  if (screen) {
    screen.hidden = false;
    const form = document.getElementById('maintAccessForm');
    const input = document.getElementById('maintAccessInput');
    const error = document.getElementById('maintAccessError');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (maintenance.unlockDeveloperAccess(input?.value)) {
        location.reload();
        return;
      }
      if (error) {
        error.hidden = false;
        error.textContent = 'Access restricted during maintenance.';
      }
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

  if (access.persistAccount && access.id) {
    try { localStorage.setItem(maintenance.DEV_ACCOUNT_CACHE_KEY, access.id); } catch { /* private mode */ }
  }
  if (access.stripParam) cleanAccessUrl();
  delete document.documentElement.dataset.maintenance;
  document.getElementById('maintenanceScreen')?.remove();
  await import('./app.js');
}

boot();
