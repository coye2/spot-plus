import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as uiEngine from '../js/ui-engine.js';
import * as dsp from '../js/dsp.js';
import * as autoeq from '../js/autoeq.js';
import * as lyricsEngine from '../js/lyrics-engine.js';
import * as automix from '../js/automix.js';
import { MusicVisualizer } from '../js/visualizer.js';

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

function makeFakeDOM() {
  const rootProps = new Map();
  const bodyProps = new Map();
  const bodyDataset = {};
  const rootDataset = {};
  return {
    documentElement: {
      dataset: rootDataset,
      style: {
        setProperty: (k, v) => rootProps.set(k, String(v)),
        getPropertyValue: (k) => rootProps.get(k) || '',
      },
    },
    body: {
      dataset: bodyDataset,
      style: {
        setProperty: (k, v) => bodyProps.set(k, String(v)),
        getPropertyValue: (k) => bodyProps.get(k) || '',
      },
    },
    _rootProps: rootProps,
    _bodyProps: bodyProps,
  };
}

test('ui-engine: normalizes and switches seamlessly between original and spotplus without reload', () => {
  const dom = makeFakeDOM();
  const storage = makeLocalStorage();
  const events = [];
  const off = uiEngine.onUIChange((cfg, meta) => events.push({ style: cfg.uiStyle, changed: meta.styleChanged }));

  const orig = uiEngine.applyUIEngine(
    { uiStyle: 'original', glassIntensity: 120, blurIntensity: 99 },
    { doc: dom, storage },
  );
  assert.equal(orig.uiStyle, 'original');
  assert.equal(dom.body.dataset.ui, 'original');
  assert.equal(dom.documentElement.dataset.ui, 'original');
  assert.equal(orig.glassIntensity, 100);
  assert.equal(orig.blurIntensity, 44);

  const sp = uiEngine.applyUIEngine(
    {
      uiStyle: 'spotplus',
      playerBg: 'fluid',
      fontChoice: 'editorial',
      animIntensity: 'subtle',
      artRadius: 22,
      visualizerMode: 'hills',
      glassIntensity: 78,
      blurIntensity: 30,
      lyricsSize: 'large',
      lyricsBlur: true,
      tabBarLabels: true,
    },
    { doc: dom, storage },
  );
  assert.equal(sp.uiStyle, 'spotplus');
  assert.equal(dom.body.dataset.ui, 'spotplus');
  assert.equal(dom.body.dataset.playerBg, 'fluid');
  assert.equal(dom.body.dataset.anim, 'subtle');
  assert.equal(dom.body.dataset.lyricsSize, 'large');
  assert.equal(dom.body.dataset.lyricsBlur, 'on');
  assert.equal(dom.body.dataset.tabLabels, 'on');
  assert.equal(dom._rootProps.get('--sp-glass-blur'), '30px');
  assert.equal(dom._rootProps.get('--sp-art-radius'), '22px');

  const chromeHint = JSON.parse(storage.getItem('spotplus.chrome'));
  assert.equal(chromeHint.uiStyle, 'spotplus');
  assert.equal(events.at(-1).style, 'spotplus');
  assert.equal(events.at(-1).changed, true);
  off();
});

test('dsp: 10-band parametric EQ, bypass detection, curve calculation, and custom preset persistence', () => {
  const storage = makeLocalStorage();
  const prevLS = globalThis.localStorage;
  globalThis.localStorage = storage;

  try {
    const def = dsp.resetDSP();
    assert.equal(def.bands.length, 10);
    assert.equal(dsp.isDSPActive(def), false, 'default flat/off DSP must report inactive for bit-transparent bypass');

    const boosted = dsp.setDSP({
      enabled: true,
      eqEnabled: true,
      bands: def.bands.map((b, i) => (i === 0 ? { ...b, gain: 6 } : b)),
    });
    assert.equal(dsp.isDSPActive(boosted), true);

    const curve = dsp.computeEQCurve(boosted.bands, [], 48);
    assert.equal(curve.length, 48);
    const lowPoint = curve[0];
    const highPoint = curve[curve.length - 1];
    assert.ok(lowPoint.db > 3.5, `expected low-end boost > 3.5 dB, got ${lowPoint.db}`);
    assert.ok(Math.abs(highPoint.db) < 1.5, `expected high-end near flat, got ${highPoint.db}`);

    const saved = dsp.saveUserEQPreset('Late Night Warm', boosted.bands, storage);
    assert.ok(saved && saved.name === 'Late Night Warm');
    assert.equal(dsp.loadUserEQPresets(storage).length, 1);
    dsp.deleteUserEQPreset(saved.id, storage);
    assert.equal(dsp.loadUserEQPresets(storage).length, 0);
  } finally {
    globalThis.localStorage = prevLS;
  }
});

test('autoeq: searches curated headphone database, parses ParametricEQ.txt, and saves custom profiles', () => {
  const storage = makeLocalStorage();
  const all = autoeq.allProfiles(storage);
  assert.ok(all.length >= 60, `expected at least 60 curated headphone profiles, got ${all.length}`);

  const airpods = autoeq.searchProfiles('AirPods Pro 2', { storage });
  assert.ok(airpods.length >= 1);
  assert.equal(airpods[0].brand, 'Apple');
  assert.ok(airpods[0].bands.length >= 5);

  const iems = autoeq.searchProfiles('', { form: 'IEM', storage, limit: 50 });
  assert.ok(iems.length >= 8);
  assert.ok(iems.every((p) => p.form === 'IEM'));

  const parsed = autoeq.parseParametricEQText(`
    Preamp: -4.8 dB
    Filter 1: ON LSC Fc 105 Hz Gain 3.2 dB Q 0.70
    Filter 2: ON PK Fc 1850 Hz Gain -2.4 dB Q 1.90
    Filter 3: ON HSC Fc 9500 Hz Gain 1.5 dB Q 0.71
  `, 'My Studio Cans');
  assert.equal(parsed.model, 'My Studio Cans');
  assert.equal(parsed.preamp, -4.8);
  assert.equal(parsed.bands.length, 3);
  assert.equal(parsed.bands[0].type, 'lowshelf');
  assert.equal(parsed.bands[1].type, 'peaking');
  assert.equal(parsed.bands[2].type, 'highshelf');

  const stored = autoeq.saveCustomProfile(parsed, storage);
  assert.ok(autoeq.findProfile(stored.id, storage));
  autoeq.deleteCustomProfile(stored.id, storage);
  assert.equal(autoeq.findProfile(stored.id, storage), null);
});

test('lyrics-engine: parses genuine enhanced LRC word timestamps and never fabricates word timings for line-only LRC', async () => {
  const lineOnly = '[00:05.00]Hello from the line\n[00:10.50]Second line here';
  const parsedLineOnly = lyricsEngine.parseEnhancedLRC(lineOnly);
  assert.equal(parsedLineOnly.length, 2);
  assert.equal(parsedLineOnly[0].words, null, 'line-only LRC must never fabricate word timestamps');
  assert.equal(lyricsEngine.hasWordTiming(parsedLineOnly), false);

  const enhanced = '[00:05.00]<00:05.00>Hello <00:05.50>world <00:06.10>tonight\n[00:09.00]<00:09.00>Next <00:09.40>line';
  const parsedEnhanced = lyricsEngine.parseEnhancedLRC(enhanced);
  assert.equal(parsedEnhanced.length, 2);
  assert.equal(lyricsEngine.hasWordTiming(parsedEnhanced), true);
  assert.equal(parsedEnhanced[0].words.length, 3);
  assert.equal(parsedEnhanced[0].words[1].text.trim(), 'world');
  assert.equal(parsedEnhanced[0].words[1].t, 5.5);

  const state = lyricsEngine.resolveActiveLyric(parsedEnhanced, 5.6, { delayMs: 0 });
  assert.equal(state.lineIndex, 0);
  assert.equal(state.wordIndex, 1);

  const delayed = lyricsEngine.resolveActiveLyric(parsedEnhanced, 5.7, { delayMs: 300 });
  assert.equal(delayed.lineIndex, 0);
  assert.equal(delayed.wordIndex, 0, 'positive Bluetooth delayMs holds lyrics back to match wireless audio latency');

  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => [[['Hola mundo esta noche\nSiguiente linea']]],
    };
  };
  const first = await lyricsEngine.translateLines(parsedEnhanced, 'es', { fetchImpl: mockFetch });
  assert.deepEqual(first, ['Hola mundo esta noche', 'Siguiente linea']);
  const second = await lyricsEngine.translateLines(parsedEnhanced, 'es', { fetchImpl: mockFetch });
  assert.deepEqual(second, ['Hola mundo esta noche', 'Siguiente linea']);
  assert.equal(fetchCalls, 1, 'cached translation should not refetch');
});

test('automix: supports selectable equal-power, smooth-s, and linear fade curves', () => {
  assert.deepEqual(automix.MIX_CURVES.map((c) => c.id), ['equal-power', 'smooth-s', 'linear']);

  const ep = automix.curveGains(0.5, 'equal-power');
  assert.ok(Math.abs(ep.outGain ** 2 + ep.inGain ** 2 - 1) < 1e-6);

  const smooth = automix.curveGains(0.5, 'smooth-s');
  assert.ok(Math.abs(smooth.outGain ** 2 + smooth.inGain ** 2 - 1) < 1e-6);
  const smoothEarly = automix.curveGains(0.2, 'smooth-s');
  const epEarly = automix.curveGains(0.2, 'equal-power');
  assert.ok(smoothEarly.inGain < epEarly.inGain, 'smooth-s eases in more gently than equal-power');

  const lin = automix.curveGains(0.25, 'linear');
  assert.equal(lin.outGain, 0.75);
  assert.equal(lin.inGain, 0.25);

  const norm = automix.normalizeMixSettings({ automix: 8, mixStyle: 'fade', mixCurve: 'smooth-s' });
  assert.equal(norm.curve, 'smooth-s');
  const curveArr = automix.buildGainCurve('in', 32, 1, 'smooth-s');
  assert.equal(curveArr.length, 32);
  assert.ok(Math.abs(curveArr[0]) < 1e-6);
  assert.ok(Math.abs(curveArr[31] - 1) < 1e-6);
});

test('visualizer: samples real AnalyserNode bins and honestly reports cors-blocked streams', () => {
  const statuses = [];
  const liveAnalyser = {
    frequencyBinCount: 64,
    fftSize: 128,
    getByteFrequencyData(arr) { arr.fill(180); },
    getByteTimeDomainData(arr) { arr.fill(140); },
  };
  let blocked = false;
  const fakeCanvas = {
    clientWidth: 320,
    clientHeight: 160,
    width: 320,
    height: 160,
    getContext() {
      return {
        setTransform() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        closePath() {},
        fill() {},
        stroke() {},
        fillRect() {},
        roundRect() {},
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; },
      };
    },
  };

  const viz = new MusicVisualizer({
    canvas: fakeCanvas,
    getAnalyser: () => liveAnalyser,
    isBlocked: () => blocked,
    isPlaying: () => true,
  });
  viz.onStatusChange = (s) => statuses.push(s);
  viz.mode = 'hills';

  const activeSample = viz.sampleAudio();
  assert.ok(activeSample && activeSample.bass > 0.1, 'real AnalyserNode sample should produce bass energy');
  assert.equal(statuses.at(-1), 'active');

  blocked = true;
  const blockedSample = viz.sampleAudio();
  assert.equal(blockedSample, null);
  assert.equal(statuses.at(-1), 'cors-blocked');
  viz.stop();
});

test('zero forbidden reference branding anywhere in app source, styles, shell, or tests', async () => {
  const forbidden = new RegExp(['vit', 'rine'].join(''), 'i');
  const targets = ['index.html', 'sw.js', 'package.json'];
  for (const dir of ['js', 'css', 'tests']) {
    for (const file of await readdir(dir)) {
      if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.css')) {
        targets.push(`${dir}/${file}`);
      }
    }
  }
  const hits = [];
  for (const file of targets) {
    const content = await readFile(file, 'utf8');
    if (forbidden.test(content)) hits.push(file);
  }
  assert.deepEqual(hits, [], `forbidden reference name found in: ${hits.join(', ')}`);
});
