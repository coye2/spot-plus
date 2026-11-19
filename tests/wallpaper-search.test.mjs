import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWallpapers, wallpapers} from '../canvas-bridge/wallpapers.js';
import {liveItem, normalizeScene, sceneFor} from '../js/backgrounds.js';

const block = (url, name, w, h, keywords = 'car, Porsche, hd wallpaper') => `<div itemprop="associatedMedia"><meta itemprop="contentUrl" content="${url}"><meta itemprop="name" content="${name}"><meta itemprop="width" content="${w}"><meta itemprop="height" content="${h}"><meta itemprop="keywords" content="${keywords}"></div>`;

test('live wallpaper search keeps desktop wallpapers only', () => {
  const html = block('https://images2.alphacoders.com/138/1389054.jpg', 'Porsche &amp; Sea - Download Free HD Wallpaper', 9504, 6336)
    + block('https://avatarfiles.alphacoders.com/383/38351.jpg', 'Avatar', 200, 200)
    + block('https://images2.alphacoders.com/138/1389054.jpg', 'Duplicate', 9504, 6336)
    + block('https://images4.alphacoders.com/100/1000.png', 'Tall art', 1000, 3000);
  const items = parseWallpapers(html);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {id:'1389054',host:'images2',folder:'138',ext:'jpg',name:'Porsche & Sea',w:9504,h:6336,category:'car'});
});

test('live search follows tag redirects to the right page', async () => {
  const seen = [];
  const fetcher = async (url) => {
    seen.push(String(url));
    if (String(url).includes('/search/view')) return new Response('', {status: 302, headers: {location: 'https://alphacoders.com/satoru-gojo'}});
    return new Response(block('https://images6.alphacoders.com/132/1322714.jpeg', 'Gojo', 7000, 3938), {status: 200});
  };
  const r = await wallpapers(new Request('https://x.dev/wallpapers?q=Gojo&page=3'), {fetcher});
  const d = await r.json();
  assert.equal(seen[1], 'https://alphacoders.com/satoru-gojo?page=3');
  assert.equal(d.items[0].id, '1322714');
  assert.equal((await wallpapers(new Request('https://x.dev/wallpapers?q=a'), {fetcher})).status, 400);
});

test('a searched wallpaper survives in settings but only points at Alpha Coders image hosts', () => {
  const item = {id:'412036',host:'images7',folder:'412',ext:'jpg',name:'Purple',w:1920,h:1200};
  assert.equal(normalizeScene({kind:'catalog',id:'412036',item}).item.host, 'images7');
  assert.equal(liveItem({...item, host:'evil.example.com/x'}), null);
  assert.equal(normalizeScene({kind:'catalog',id:'412036',item:{...item, host:'evil'}}).item, undefined);
  assert.equal(sceneFor('catalog', 'nope', null).item, undefined);
});

test('phones get portrait phone wallpapers; desktops keep landscape', () => {
  const html = block('https://mfiles.alphacoders.com/101/1018746.png', 'Cabin iPhone Wallpaper', 0, 0, 'Minecraft, cabin, phone wallpaper')
    + block('https://images2.alphacoders.com/138/1389054.jpg', 'Wide', 1920, 1080);
  assert.deepEqual(parseWallpapers(html, {device: 'phone'}).map(i => [i.host, i.name]), [['mfiles', 'Cabin']]);
  assert.deepEqual(parseWallpapers(html).map(i => i.host), ['images2']);
  assert.equal(liveItem({id: '1018746', host: 'mfiles', folder: '101', ext: 'png'}).host, 'mfiles');
});
