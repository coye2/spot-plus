import test from 'node:test';
import assert from 'node:assert/strict';
import {linkTarget, ogImage, wallhavenItems, openverseItems, images} from '../canvas-bridge/images.js';
import {liveItem, wallpaperURLs} from '../js/backgrounds.js';

test('links: Pinterest pins, Google Images results and image links are recognised; other pages are not', () => {
  assert.deepEqual(linkTarget('https://www.pinterest.com/pin/1688918605893553/'), {kind: 'page', url: 'https://www.pinterest.com/pin/1688918605893553/', from: 'Pinterest'});
  assert.equal(linkTarget('pin.it/3xYz9ab').from, 'Pinterest');
  assert.deepEqual(linkTarget('https://www.google.com/imgres?imgurl=https://x.example/a.jpg&imgrefurl=y'), {kind: 'image', url: 'https://x.example/a.jpg', from: 'Google Images'});
  assert.equal(linkTarget('https://x.example/pic.webp').kind, 'image');
  assert.equal(linkTarget('https://example.com/article'), null);
  assert.equal(linkTarget('javascript:alert(1)'), null);
});

test('a pin’s preview image becomes its full-size picture', () => {
  assert.equal(ogImage('<meta content="https://i.pinimg.com/736x/f2/8a/a.jpg" name="og:image" property="og:image"/>'), 'https://i.pinimg.com/originals/f2/8a/a.jpg');
});

test('search results from Wallhaven and Openverse become background items the picker accepts', () => {
  const wh = wallhavenItems({data: [{id: 'wq62z7', path: 'https://w.wallhaven.cc/full/wq/wallhaven-wq62z7.jpg', thumbs: {large: 'https://th.wallhaven.cc/lg/wq/wq62z7.jpg'}, dimension_x: 5120, dimension_y: 3200}]});
  const ov = openverseItems({results: [{id: 'be80ce09-4144-4744-a591-9cee83cfbdcd', url: 'https://live.staticflickr.com/2106/x.jpg', thumbnail: 'https://api.openverse.org/v1/images/be80/thumb/', title: 'Night City', width: 1024, height: 768}]});
  for (const raw of [...wh, ...ov]) {
    const item = liveItem(raw);
    assert.ok(item, raw.id);
    assert.equal(wallpaperURLs(item).full, raw.full);
  }
  assert.equal(liveItem({src: 'wallhaven', id: 'wh-x', full: 'http://insecure/a.jpg'}), null);
});

test('a search asks both sources and mixes their results', async () => {
  const fetcher = async (u) => String(u).includes('wallhaven')
    ? new Response(JSON.stringify({data: [{id: 'aaaaaa', path: 'https://w.wallhaven.cc/full/aa/a.jpg', thumbs: {}}], meta: {last_page: 3}}))
    : new Response(JSON.stringify({results: [{id: 'abcdef12', url: 'https://img.example/b.jpg', title: 'B'}], page_count: 1}));
  const r = await images(new Request('https://w.dev/images?q=night'), {fetcher});
  const d = await r.json();
  assert.deepEqual(d.items.map((x) => x.src), ['wallhaven', 'openverse']);
  assert.equal(d.more, true);
});
