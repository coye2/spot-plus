// Spot+ is free, powered by love and support. Full access is a star, a Discord
// membership, or a friend who installs Spot+ — each one checked, not a button.
import { ACTION_LABELS, DAILY_LIMIT, DISCORD, REPO } from './access-policy.js';
import {
  createReferral, discordStartUrl, githubStartUrl, isFeatureRestricted, onAccessBlocked, onAccessChange,
  onAccessNotice, redeemReferral, refreshAccess, snapshot, startAccessSync, verifyUsername, consumeStarQuery,
} from './access.js';

const REASONS = {
  'not-starred': 'That GitHub account has no public star on ' + REPO.full + ' yet. Star the repo, then verify again.',
  'not-found': 'No GitHub account uses that username.',
  invalid: 'That code or username doesn’t check out. Use the 8-character friend code, or the GitHub username that starred the repo.',
  'rate-limited': 'Too many checks right now. Wait a few minutes and try again.',
  unavailable: 'Spot+ couldn’t finish that check. Try again in a moment.',
  incomplete: 'Star the repo again so it is the most recent star, then verify.',
  'device-cap': 'That support account already unlocked 3 devices.',
  denied: 'Sign-in was cancelled before Spot+ could check.',
  'not-member': 'That Discord account isn’t in the Spot+ server yet. Join, then verify again.',
  install: 'Install Spot+ to the home screen or desktop first, then enter the code from the installed app.',
  self: 'This device made the code. A different person’s install has to enter it.',
  'not-new': 'This install was already using Spot+ before the code was created.',
  'same-device': 'This looks like the same phone or computer — another browser, profile, or VPN still matches. Ask someone on their own device.',
  'same-browser': 'This browser matches the device that made the code.',
  'same-network': 'This device is on the same network and looks too close to the one that made the code.',
  taken: 'That code was already used.',
  used: 'This install already supported someone.',
  excluded: 'This device is excluded. A friend’s own install has to enter the code.',
  expired: 'That code expired. Ask for a new one.',
  hold: 'Keep the installed app open. Spot+ is making sure this is a real install.',
  ok: '',
};

let toastFn = () => {};
let onChange = () => {};
let dialog;
let openedAt = 0;
let poll = 0;
let holdTimer = 0;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function whoLine(login) {
  if (!login || login === 'a friend') return 'Full access is unlocked on this device, thanks to a friend who installed Spot+.';
  return `Full access is unlocked on this device for <b>@${esc(login)}</b>.`;
}

export function accessSettingsHtml() {
  const s = snapshot();
  if (s.tier === 'full') {
    const note = s.exempt && !s.login
      ? 'This device is one of yours, so it is excluded from the daily allowance.'
      : whoLine(s.login) + ' Skips, Insta Play, and Insta Choose are unlimited here.';
    return `<section class="box" id="accessSettings"><h2>Support</h2><p class="settings-note">Spot+ is free, powered by love and support. ${note}</p>
      <div class="row-btns"><a class="btn small" href="${esc(DISCORD.invite)}" target="_blank" rel="noopener noreferrer">Discord</a><a class="btn small" href="${esc(REPO.url)}" target="_blank" rel="noopener noreferrer">GitHub</a></div></section>`;
  }
  const left = s.remaining == null ? DAILY_LIMIT : s.remaining;
  const network = s.ipUsed > s.deviceUsed ? ' This network has used more of today’s allowance than this device.' : '';
  return `<section class="box" id="accessSettings"><h2>Support</h2>
    <p class="settings-note">Spot+ is free, powered by love and support. The base tier includes <b>${DAILY_LIMIT}</b> skips, Insta Plays, and Insta Chooses a day, counted on this device and on this network.${network}</p>
    <p class="settings-note"><b>${left}</b> left today${s.limited ? '. Extra controls pause until tomorrow, or until you support the project.' : '. Star the repo, join the Discord, or invite a friend to install Spot+ for full access.'}</p>
    <div class="row-btns"><button type="button" class="btn small primary" data-act="access-unlock">${s.limited ? 'Support to unlock' : 'Support Spot+'}</button></div>
  </section>`;
}

function ensureDialog() {
  if (dialog?.isConnected) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'accessDlg';
  dialog.className = 'access-dlg';
  dialog.innerHTML = `<div class="access-sheet">
    <p class="access-kicker">Free, powered by support</p>
    <h3 id="accessTitle">Support Spot+</h3>
    <p class="access-copy" id="accessCopy"></p>
    <section class="access-way">
      <h4>Star the repo</h4>
      <a class="btn primary access-star" href="${esc(REPO.url)}" target="_blank" rel="noopener noreferrer">Star ${esc(REPO.full)}</a>
      <label class="access-login">GitHub username<input name="login" maxlength="39" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="username" aria-label="GitHub username"></label>
      <button type="button" class="btn primary" id="accessVerify">Verify star</button>
      <button type="button" class="btn access-oauth" id="accessOauth" hidden>Verify fully with GitHub</button>
    </section>
    <section class="access-way">
      <h4>No GitHub? Add support another way</h4>
      <p class="access-help">Join the Discord server, or refer a friend. They install Spot+ and enter your code. Spot+ compares the two installs, so another browser, phone, or VPN on this device does not count.</p>
      <a class="btn primary access-star" href="${esc(DISCORD.invite)}" target="_blank" rel="noopener noreferrer">Join the Discord</a>
      <button type="button" class="btn" id="accessDiscord" hidden>Verify Discord membership</button>
      <button type="button" class="btn" id="accessCode">Get a friend code</button>
      <p class="access-code" id="accessCodeOut" hidden></p>
      <label class="access-login">A friend’s code<input name="friend" maxlength="12" autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="off" placeholder="8 characters" aria-label="Friend code"></label>
      <button type="button" class="btn" id="accessRedeem">Verify their install</button>
      <p class="access-hold" id="accessHold" hidden></p>
    </section>
    <p class="access-error" id="accessError" hidden></p>
    <div class="dlg-btns"><button type="button" class="btn" id="accessLater">Not now</button></div>
    <p class="access-fine">Spot+ checks the star with GitHub, the Discord membership with Discord sign-in, and the friend code against the new install. A button press alone does not unlock the app.</p>
  </div>`;
  document.body.append(dialog);
  dialog.querySelector('#accessLater').addEventListener('click', () => dialog.close());
  dialog.querySelector('#accessVerify').addEventListener('click', () => submitVerify(dialog.querySelector('input[name="login"]').value));
  dialog.querySelector('#accessOauth').addEventListener('click', () => { location.href = githubStartUrl(location.href); });
  dialog.querySelector('#accessDiscord').addEventListener('click', () => { location.href = discordStartUrl(location.href); });
  dialog.querySelector('#accessCode').addEventListener('click', () => makeCode());
  dialog.querySelector('#accessRedeem').addEventListener('click', () => submitRedeem(dialog.querySelector('input[name="friend"]').value));
  dialog.addEventListener('close', () => { clearInterval(poll); clearTimeout(holdTimer); });
  return dialog;
}

function setError(message) {
  const el = dialog?.querySelector('#accessError');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
}

function celebrate(login) {
  dialog?.close();
  const who = login && login !== 'a friend' ? ' for @' + login : '';
  toastFn('Full access unlocked' + who + '. Thank you for supporting Spot+.');
  onChange(snapshot());
}

export function openAccessPrompt({ feature = '', error = '' } = {}) {
  const s = snapshot();
  if (s.tier === 'full') return;
  const dlg = ensureDialog();
  const limited = s.limited;
  dlg.querySelector('#accessTitle').textContent = limited ? 'Today’s allowance is used' : 'Support Spot+';
  const featureName = ACTION_LABELS[feature] || '';
  const paused = 'The song already playing can finish, and the queue can still move on. Skips, Insta Play, Insta Choose, seeking, new downloads, repeat, and Canvas wait until tomorrow.';
  dlg.querySelector('#accessCopy').textContent = limited
    ? `Spot+ is free, powered by love and support. This device and this network have shared today’s ${DAILY_LIMIT} skips, Insta Plays, and Insta Chooses.${featureName ? ' ' + featureName + ' is paused.' : ''} ${paused}`
    : `Spot+ is free. Star the GitHub repo, join the Discord, or invite a friend to install it, and the daily cap comes off this device.`;
  dlg.querySelector('#accessOauth').hidden = !s.oauth;
  dlg.querySelector('#accessDiscord').hidden = !s.discord;
  setError(error);
  if (!dlg.open) dlg.showModal();
  openedAt = Date.now();
}

async function submitVerify(login) {
  const button = dialog.querySelector('#accessVerify');
  button.disabled = true;
  button.textContent = 'Checking GitHub…';
  setError('');
  const result = await verifyUsername(login);
  button.disabled = false;
  button.textContent = 'Verify star';
  if (result?.ok) { celebrate(result.login); return; }
  setError(REASONS[result?.reason] || REASONS.unavailable);
}

async function makeCode() {
  const button = dialog.querySelector('#accessCode');
  const out = dialog.querySelector('#accessCodeOut');
  button.disabled = true;
  setError('');
  const result = await createReferral();
  button.disabled = false;
  if (!result?.ok || !result.code) { setError(REASONS[result?.reason] || REASONS.unavailable); return; }
  out.hidden = false;
  out.textContent = result.code;
  try { await navigator.clipboard.writeText(result.code); toastFn('Friend code copied. They install Spot+ and enter it.'); } catch { toastFn('Friend code ready. They install Spot+ and enter ' + result.code + '.'); }
  clearInterval(poll);
  poll = setInterval(async () => {
    const snap = await refreshAccess();
    if (snap?.tier === 'full') celebrate(snap.login);
  }, 8000);
}

async function submitRedeem(code, challenge = '') {
  const button = dialog.querySelector('#accessRedeem');
  const hold = dialog.querySelector('#accessHold');
  button.disabled = true;
  setError('');
  const result = await redeemReferral(code, challenge);
  if (result?.reason === 'hold') {
    const wait = Math.max(1000, Number(result.waitMs) || 60000);
    hold.hidden = false;
    hold.textContent = REASONS.hold;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => submitRedeem(code, result.challenge || challenge), wait);
    return;
  }
  button.disabled = false;
  hold.hidden = true;
  if (result?.ok) {
    dialog.close();
    toastFn('Thank you. Your friend’s Spot+ unlocks the next time they open it.');
    return;
  }
  setError(REASONS[result?.reason] || REASONS.unavailable);
}

function syncBanner(snap = snapshot()) {
  let banner = document.getElementById('accessBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'accessBanner';
    banner.className = 'access-banner';
    banner.hidden = true;
    banner.innerHTML = '<p>Spot+ is free, powered by love and support.</p><button type="button" class="btn small primary" data-act="access-unlock">Support to unlock</button>';
    document.body.append(banner);
  }
  const limited = snap.tier !== 'full' && snap.limited;
  banner.hidden = !limited;
  document.documentElement.dataset.access = snap.tier === 'full' ? 'full' : limited ? 'limited' : 'base';
}

export function startAccess({ toast = () => {}, onChange: change = () => {} } = {}) {
  toastFn = toast;
  onChange = change;
  onAccessChange((snap) => { syncBanner(snap); change(snap); });
  onAccessBlocked((info) => {
    if (Date.now() - openedAt < 1200 && dialog?.open) return;
    openAccessPrompt({ feature: info.feature });
  });
  onAccessNotice((info) => { if (info.notice) toastFn(info.notice); });
  const star = consumeStarQuery();
  startAccessSync().then((snap) => {
    syncBanner(snap);
    if (star === 'ok' && snap?.tier === 'full') toastFn('Full access unlocked' + (snap.login ? ' for @' + snap.login : '') + '. Thank you for supporting Spot+.');
    else if (star && star !== 'ok') openAccessPrompt({ error: REASONS[star] || REASONS.unavailable });
  });
  syncBanner();
}

export { isFeatureRestricted, openAccessPrompt as showAccessPrompt };
