// Rate Spot+: a 5-star dialog that appears rarely and only at a good moment (a song just changed while you're
// listening, after you've used Spot+ for a while), and the live average shown with the other counters.
import {STATS_URL, deviceId} from './live-stats.js';

const KEY = 'spotplus.rating';
const DAY = 86400e3;
const read = (storage) => { try { return JSON.parse(storage?.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (storage, v) => { try { storage?.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };

/** Remember when Spot+ was first used, so nobody is asked on day one. */
export function noteUse(now = Date.now(), storage = globalThis.localStorage) {
  const s = read(storage);
  if (!s.first) { s.first = now; write(storage, s); }
}
/**
 * Ask only when all of these hold: used for 3+ days, 20+ songs played, not rated yet, not "never ask",
 * not asked in the last 21 days (or 60 after "Not now" twice), and at most once per visit.
 */
export function shouldAsk({plays = 0, now = Date.now(), shownThisVisit = false, storage = globalThis.localStorage} = {}) {
  const s = read(storage);
  if (shownThisVisit || s.stars || s.never || !s.first) return false;
  if (now - s.first < 3 * DAY || plays < 20) return false;
  const wait = (s.snoozes || 0) >= 2 ? 60 * DAY : 21 * DAY;
  return !s.askedAt || now - s.askedAt >= wait;
}
export function noteAsked(answer, now = Date.now(), storage = globalThis.localStorage) {
  const s = read(storage);
  s.askedAt = now;
  if (answer === 'later') s.snoozes = (s.snoozes || 0) + 1;
  if (answer === 'never') s.never = true;
  write(storage, s);
}
export const myRating = (storage = globalThis.localStorage) => Number(read(storage).stars) || 0;

/** Sends your rating (one per device; rating again replaces it). Returns the new live summary, or null. */
export async function submit(stars, storage = globalThis.localStorage) {
  const s = read(storage);
  s.stars = stars; s.askedAt = Date.now();
  write(storage, s);
  const id = deviceId(storage);
  if (!id) return null;
  try {
    const r = await fetch(STATS_URL + '/rate', {method: 'POST', body: JSON.stringify({device: id, stars}), credentials: 'omit'});
    return r.ok ? (await r.json()).rating : null;
  } catch { return null; }
}

/** "★★★★½ 4.6 · 128 ratings" pieces for the counters. */
export function starsHtml(average = 0, size = '') {
  const pct = Math.max(0, Math.min(100, (average / 5) * 100));
  return `<span class="stars${size ? ' ' + size : ''}" role="img" aria-label="${average.toFixed(1)} out of 5 stars"><span class="stars-fill" style="width:${pct}%">★★★★★</span>★★★★★</span>`;
}
export function ratingText(rating) {
  if (!rating?.count) return 'No ratings yet';
  return `${rating.average.toFixed(1)} · ${rating.count.toLocaleString('en-US')} rating${rating.count === 1 ? '' : 's'}`;
}

/** The dialog. Resolves with the stars chosen, 'later', or 'never'. */
export function openDialog({current = 0} = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'rate-dialog';
    d.innerHTML = `<form method="dialog"><img src="icons/icon-192.png" alt="" width="64" height="64"><h3>Enjoying Spot+?</h3><p>Tap a star to rate it. It takes a second and helps more than you’d think.</p>
      <div class="rate-stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === current}" aria-label="${n} star${n > 1 ? 's' : ''}" data-n="${n}"${n <= current ? ' class="on"' : ''}>★</button>`).join('')}</div>
      <p class="rate-thanks" hidden></p>
      <div class="rate-actions"><button type="button" class="btn small" data-a="never">Don’t ask again</button><button type="button" class="btn small" data-a="later">Not now</button></div></form>`;
    document.body.append(d);
    let done = false;
    const finish = (v) => { if (done) return; done = true; setTimeout(() => { d.close(); d.remove(); }, typeof v === 'number' ? 1100 : 0); resolve(v); };
    const stars = [...d.querySelectorAll('.rate-stars button')];
    const light = (n) => stars.forEach((b) => b.classList.toggle('on', Number(b.dataset.n) <= n));
    for (const b of stars) {
      b.addEventListener('pointerenter', () => light(Number(b.dataset.n)));
      b.addEventListener('pointerleave', () => light(current));
      b.addEventListener('click', () => {
        const n = Number(b.dataset.n); current = n; light(n);
        stars.forEach((x) => x.setAttribute('aria-checked', String(Number(x.dataset.n) === n)));
        const t = d.querySelector('.rate-thanks');
        t.hidden = false; t.textContent = n >= 4 ? 'Thank you! That means a lot.' : 'Thanks for being honest. Spot+ keeps getting better.';
        finish(n);
      });
    }
    d.querySelector('[data-a="later"]').addEventListener('click', () => finish('later'));
    d.querySelector('[data-a="never"]').addEventListener('click', () => finish('never'));
    d.addEventListener('cancel', () => finish('later'));
    d.showModal();
  });
}
