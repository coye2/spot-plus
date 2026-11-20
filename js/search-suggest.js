// Search autocomplete: as you type, a short list under the search box with your matching recent searches,
// artists whose name starts with what you typed (with their photos) and songs you've seen in results.
// Arrow keys move through it, Enter picks, Escape closes.

const fold = (v) => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Pure: builds the suggestion list. Each item: {kind: 'recent'|'artist'|'song'|'search'|'spotify', text, sub?, picture?, href?} */
export function buildSuggestions({q = '', recents = [], artists = [], songs = [], max = 7} = {}) {
  const f = fold(q), out = [], seen = new Set();
  const add = (item) => { const k = item.kind === 'artist' ? 'a:' + fold(item.text) : fold(item.text); if (!item.text || seen.has(k)) return; seen.add(k); out.push(item); };
  if (/open\.spotify\.com\/|spotify:(track|album|playlist|artist):/i.test(q)) return [{kind: 'spotify', text: 'Open this Spotify link in Spot+'}];
  if (!f) return recents.slice(0, 6).map((text) => ({kind: 'recent', text}));
  const starts = (s) => fold(s).startsWith(f) || fold(s).split(/\s+/).some((w) => w.startsWith(f));
  recents.filter((r) => fold(r).startsWith(f) && fold(r) !== f).slice(0, 2).forEach((text) => add({kind: 'recent', text}));
  artists.filter((a) => starts(a.name)).sort((a, b) => (fold(b.name).startsWith(f) - fold(a.name).startsWith(f)) || (b.fans || 0) - (a.fans || 0))
    .slice(0, 3).forEach((a) => add({kind: 'artist', text: a.name, sub: 'Artist', picture: a.picture, href: '#/artist/' + a.id}));
  songs.filter((t) => starts(t.title)).slice(0, 3).forEach((t) => add({kind: 'song', text: t.title, sub: 'Song · ' + t.artist, picture: t.cover, query: `${t.title} ${t.artist}`}));
  if (out.length && fold(out[0].text) !== f) out.push({kind: 'search', text: q});
  return out.slice(0, max);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ICON = {
  recent: '<path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z"/>',
  search: '<path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.39-1.42 1.42-5.39-5.39A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/>',
  spotify: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.7.7 0 0 1-1 .2c-2.6-1.6-5.9-2-9.8-1.1a.7.7 0 1 1-.3-1.4c4.2-1 7.9-.5 10.8 1.3.4.2.5.7.3 1zm1.2-2.7a.9.9 0 0 1-1.2.3c-3-1.8-7.5-2.4-11-1.3a.9.9 0 1 1-.5-1.7c4-1.2 9-.6 12.4 1.5.4.3.5.8.3 1.2zm.1-2.8C14.3 8.8 8.4 8.6 5 9.6a1.1 1.1 0 1 1-.6-2.1c3.9-1.2 10.4-1 14.5 1.5a1.1 1.1 0 0 1-1 1.9z"/>',
};

/** Attaches the dropdown to a search input. pick(item) handles a choice; data() returns {recents, artists, songs}. */
export function attach(input, {data, pick}) {
  if (!input || input.dataset.suggest) return;
  input.dataset.suggest = '1';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  const box = document.createElement('div');
  box.className = 'suggest';
  box.id = input.id + 'Suggest';
  box.setAttribute('role', 'listbox');
  box.hidden = true;
  input.setAttribute('aria-controls', box.id);
  (input.closest('form') || input.parentElement).append(box);
  let items = [], active = -1;
  const render = () => {
    items = buildSuggestions({q: input.value, ...data()});
    active = -1;
    box.hidden = !items.length || document.activeElement !== input;
    input.setAttribute('aria-expanded', String(!box.hidden));
    box.innerHTML = items.map((it, i) => `<div class="suggest-item" role="option" id="${box.id}-${i}" data-i="${i}">${it.picture ? `<img src="${esc(it.picture)}" alt=""${it.kind === 'artist' ? ' class="round"' : ''}>` : `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[it.kind] || ICON.search}</svg>`}<span><b>${esc(it.text)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></div>`).join('');
  };
  const move = (d) => {
    if (box.hidden || !items.length) return;
    active = (active + d + items.length) % items.length;
    box.querySelectorAll('.suggest-item').forEach((n, i) => n.classList.toggle('on', i === active));
    input.setAttribute('aria-activedescendant', box.id + '-' + active);
  };
  const choose = (i) => { const it = items[i]; box.hidden = true; if (it) pick(it, input); };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Escape') { box.hidden = true; }
    else if (e.key === 'Enter' && active >= 0 && !box.hidden) { e.preventDefault(); choose(active); }
  });
  // pointerdown (before blur) so a tap always lands on the item.
  box.addEventListener('pointerdown', (e) => { const n = e.target.closest('.suggest-item'); if (n) { e.preventDefault(); choose(Number(n.dataset.i)); } });
  return {refresh: render, hide: () => { box.hidden = true; }};
}
