import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG, CATEGORIES} from '../js/background-catalog.js';
import {coverCrop, deviceTier, sourceForDevice, targetPixels, wallpaperURLs, positionOf, normalizeScene} from '../js/backgrounds.js';

const phone = {width: 390, height: 844, dpr: 3};
const desktop = {width: 1920, height: 1080, dpr: 2};

test('Alpha Coders catalog is 4K-class and every image URL is direct', () => {
  assert.ok(CATALOG.length >= 2000);
  const names = CATEGORIES.map(item => typeof item === 'string' ? item : item.name);
  assert.ok(names.includes('Nature') && names.includes('Abstract'));
  for (const item of CATALOG) {
    assert.ok(item.w >= 1920 && item.h >= 1080, item.name);
    const urls = wallpaperURLs(item);
    assert.match(urls.full, new RegExp(`^https://${item.host}\\.alphacoders\\.com/${item.folder}/${item.id}\\.${item.ext}$`));
    assert.match(urls.fhd, /thumb-1920-/);
    assert.match(urls.preview, /thumb-350-/);
  }
});

test('crop size follows the device and phones do not pull the 4K file', () => {
  const item = CATALOG.find(entry => entry.w >= 3840);
  const small = sourceForDevice(item, phone);
  const large = sourceForDevice(item, desktop);
  assert.equal(deviceTier(phone), 'fhd');
  assert.equal(small.tier, 'fhd');
  assert.match(small.url, /thumb-1920-/);
  assert.equal(large.tier, '4k');
  assert.match(large.url, new RegExp(`${item.id}\\.${item.ext}$`));
  const pixels = targetPixels(phone);
  assert.ok(pixels.width <= 1280 && pixels.height <= 3840);
  assert.equal(targetPixels(desktop).cap, 3840);
});

test('cover crop stays inside the photo and matches the frame', () => {
  const crop = coverCrop(3840, 2160, 1170, 2532, {x: 0.2, y: 0.1});
  assert.ok(Math.abs(crop.width / crop.height - 1170 / 2532) < 0.02);
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= 3840.1);
  assert.ok(crop.y + crop.height <= 2160.1);
  const edge = coverCrop(1000, 1000, 500, 200, {x: 0, y: 1});
  assert.equal(edge.x, 0);
  assert.ok(edge.y + edge.height <= 1000.1);
});

test('a saved background keeps a clamped crop point', () => {
  assert.equal(normalizeScene(null), null);
  assert.deepEqual(normalizeScene({kind: 'catalog', id: '724313', x: 2, y: -1}), {kind: 'catalog', id: '724313', x: 1, y: 0});
  assert.equal(positionOf({x: 0.5, y: 0.42}), '50% 42%');
});
