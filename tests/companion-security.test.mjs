import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {access, readFile} from 'node:fs/promises';
import {COMPANION_VERSION} from '../js/spotify-reader.js';

const USER_SCRIPT_URL = new URL('../js/spotplus-spotify.user.js', import.meta.url);
const META_SCRIPT_URL = new URL('../js/spotplus-spotify.meta.js', import.meta.url);
const LEGACY_CORE_URL = new URL('../js/spotplus-helper-core.js', import.meta.url);

function createMemoryStorage(initial = {}, {throwOnRemove = false, throwOnGet = false} = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      if (throwOnGet) throw new Error('Storage getItem blocked');
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      if (throwOnRemove) throw new Error('Storage removeItem blocked');
      map.delete(String(key));
    },
    snapshot() {
      return Object.fromEntries(map.entries());
    },
  };
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.dataset = {};
    this.style = {cssText: ''};
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.src = '';
    this.onload = null;
    this.onerror = null;
    this.onclick = null;
    this.listeners = new Map();
    this._innerHTML = '';
    this.shadowRoot = null;
  }
  set innerHTML(html) {
    this._innerHTML = String(html);
    this._byId = new Map();
    for (const [, id] of this._innerHTML.matchAll(/\bid="([^"]+)"/g)) {
      const el = new FakeElement('div');
      el.id = id;
      this._byId.set(id, el);
    }
    this._h2 = new FakeElement('h2');
  }
  get innerHTML() {
    return this._innerHTML;
  }
  attachShadow() {
    const root = new FakeElement('shadow-root');
    this.shadowRoot = root;
    return root;
  }
  getElementById(id) {
    return this._byId?.get(id) || null;
  }
  querySelector(sel) {
    if (sel === 'h2') return this._h2 || null;
    return null;
  }
  querySelectorAll(sel) {
    if (sel === 'button') return [...(this._byId?.values() || [])];
    return [];
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
      this._onAppend?.(node);
    }
  }
  remove() {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx >= 0) this.parentNode.children.splice(idx, 1);
    this.parentNode = null;
  }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }
}

/**
 * Simulates supported userscript managers executing the generated userscript on a page:
 * - manager: 'tampermonkey-raw' | 'safari-userscripts' | 'violentmonkey-content' | 'strict-csp-no-blob'
 */
function createManagerHarness(options = {}) {
  const {
    manager = 'tampermonkey-raw',
    origin = 'https://open.spotify.com',
    pathname = '/collection',
    search = '',
    hash = '',
    inFrame = false,
    delayDocumentElement = false,
    initialLocalStorage = {},
    initialSessionStorage = {},
    storageGetterThrows = false,
    storageRemoveThrows = false,
    offline = false,
    allowInlineScript = manager === 'tampermonkey-raw',
    allowBlobScript = manager !== 'strict-csp-no-blob',
    isolatedWorld = manager === 'safari-userscripts' || manager === 'violentmonkey-content',
  } = options;

  const localStore = createMemoryStorage(initialLocalStorage, {throwOnRemove: storageRemoveThrows});
  const sessionStore = createMemoryStorage(initialSessionStorage);
  const fetchCalls = [];
  const evalCalls = [];
  const blobUrls = new Map();
  const revokedUrls = [];
  const injectedMethods = [];
  let blobSeq = 0;

  const baseFetch = async (url, init) => {
    fetchCalls.push({url: String(url), init});
    if (offline) throw new TypeError('Failed to fetch');
    return new Response('{}', {status: 200, headers: {'content-type': 'application/json'}});
  };

  const observers = [];
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.active = false;
    }
    observe() {
      this.active = true;
      observers.push(this);
    }
    disconnect() {
      this.active = false;
    }
  }

  const body = new FakeElement('body');
  const html = new FakeElement('html');
  const doc = {
    documentElement: delayDocumentElement ? null : html,
    body,
    createElement(tag) {
      return new FakeElement(tag);
    },
    getElementById(id) {
      return body.children.find(c => c.id === id) || null;
    },
    addEventListener() {},
  };

  function makeWindow(worldName) {
    const win = {
      location: {origin, pathname, search, hash, href: origin + pathname + search + hash},
      navigator: {userAgent: manager === 'safari-userscripts' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' : 'Mozilla/5.0 Chrome/130.0', platform: 'MacIntel', maxTouchPoints: 0},
      document: doc,
      history: {state: null, replaceState() {}},
      fetch: baseFetch,
      XMLHttpRequest: class FakeXHR {
        open() {}
        setRequestHeader() {}
        send() {}
      },
      Headers,
      Request,
      Response,
      URL: class FakeURL extends URL {
        static createObjectURL(blob) {
          const id = `blob:${origin}/${++blobSeq}`;
          blobUrls.set(id, blob);
          return id;
        }
        static revokeObjectURL(id) {
          revokedUrls.push(id);
          blobUrls.delete(id);
        }
      },
      Blob: class FakeBlob {
        constructor(parts, opts) {
          this.parts = parts;
          this.type = opts?.type || '';
          this._text = parts.map(p => String(p)).join('');
        }
      },
      MutationObserver: FakeMutationObserver,
      AbortController,
      TextEncoder,
      TextDecoder,
      atob,
      btoa,
      crypto: globalThis.crypto,
      setTimeout: () => 1,
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {},
      addEventListener() {},
      eval(code) {
        evalCalls.push({worldName, code});
        throw new Error('CSP blocked eval');
      },
      sessionStorage: sessionStore,
      console,
    };
    win.window = win;
    win.self = win;
    win.top = inFrame ? {} : win;
    if (storageGetterThrows) {
      Object.defineProperty(win, 'localStorage', {
        get() {
          throw new Error('SecurityError: The operation is insecure.');
        },
        configurable: true,
      });
    } else {
      win.localStorage = localStore;
    }
    return win;
  }

  const pageWindow = makeWindow('page');
  const pageContext = vm.createContext(pageWindow);
  const scriptWindow = isolatedWorld ? makeWindow('isolated') : pageWindow;
  const scriptContext = isolatedWorld ? vm.createContext(scriptWindow) : pageContext;

  html._onAppend = (node) => {
    if (node.tagName !== 'SCRIPT') return;
    if (node.src && node.src.startsWith('blob:')) {
      if (allowBlobScript) {
        const blob = blobUrls.get(node.src);
        injectedMethods.push('blob');
        vm.runInContext(blob._text, pageContext, {filename: 'blob-injected.js'});
        node.onload?.();
      } else {
        injectedMethods.push('blob-blocked');
        node.onerror?.();
      }
      return;
    }
    if (node.textContent) {
      if (allowInlineScript) {
        injectedMethods.push('inline');
        vm.runInContext(node.textContent, pageContext, {filename: 'inline-injected.js'});
      } else {
        injectedMethods.push('inline-blocked');
      }
    }
  };

  return {
    pageWindow,
    scriptWindow,
    localStore,
    sessionStore,
    fetchCalls,
    evalCalls,
    revokedUrls,
    injectedMethods,
    doc,
    attachDocumentElement() {
      doc.documentElement = html;
      for (const obs of [...observers]) {
        if (obs.active) obs.cb([], obs);
      }
    },
    runUserscript(source) {
      vm.runInContext(source, scriptContext, {filename: 'spotplus-spotify.user.js'});
    },
    mountedVersionText() {
      const host = doc.getElementById('spotplus-companion');
      return host?.shadowRoot?.querySelector('h2')?.children?.[0]?.textContent || null;
    },
  };
}

test('packaged userscript and metadata remove localStorage code execution, remote helper-core fetches, and eval', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');
  const metaSource = await readFile(META_SCRIPT_URL, 'utf8');

  assert.equal(userSource.match(/^\/\/ @version\s+(\S+)/m)?.[1], COMPANION_VERSION);
  assert.equal(metaSource.match(/^\/\/ @version\s+(\S+)/m)?.[1], COMPANION_VERSION);
  assert.match(metaSource, /^\/\/ @updateURL\s+https:\/\/coye2\.github\.io\/spot-plus\/js\/spotplus-spotify\.meta\.js$/m);
  assert.match(metaSource, /^\/\/ @downloadURL\s+https:\/\/coye2\.github\.io\/spot-plus\/js\/spotplus-spotify\.user\.js$/m);
  assert.match(userSource, /^\/\/ @updateURL\s+https:\/\/coye2\.github\.io\/spot-plus\/js\/spotplus-spotify\.meta\.js$/m);
  assert.match(userSource, /^\/\/ @downloadURL\s+https:\/\/coye2\.github\.io\/spot-plus\/js\/spotplus-spotify\.user\.js$/m);
  assert.match(userSource, /^\/\/ @noframes$/m);

  // Must NEVER read, store, fetch, or execute helper code from page-owned localStorage or remote helper-core.
  assert.doesNotMatch(userSource, /spotplus-helper-core\.js/);
  assert.doesNotMatch(userSource, /localStorage\.getItem\(\s*['"]spotplus\.helperCore/);
  assert.doesNotMatch(userSource, /localStorage\.setItem\(\s*['"]spotplus\.helperCore/);
  assert.doesNotMatch(userSource, /\(0\s*,\s*eval\)|\beval\s*\(/);
  assert.doesNotMatch(userSource, /\bnew\s+Function\s*\(/);

  // Obsolete unauthenticated helper-core artifact must not be published.
  await assert.rejects(access(LEGACY_CORE_URL));
});

test('tampered localStorage cache never executes, is cleaned up, and preserves user data across managers', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');
  const syncKey = 'a'.repeat(64);
  const tamperedPayload = '/*spotplus-helper-core*/window.__TAMPERED_EXECUTED=true;document.documentElement.dataset.spotplusCompanion="pwned";';

  for (const manager of ['tampermonkey-raw', 'safari-userscripts', 'violentmonkey-content', 'strict-csp-no-blob']) {
    const harness = createManagerHarness({
      manager,
      initialLocalStorage: {
        'spotplus.helperCore': tamperedPayload,
        'spotplus.helperCoreAt': String(Date.now()),
        'spotplus.syncKey': syncKey,
        'spotplus.syncAt': '1700000000000',
        'spotify.user.pref': '{"volume":0.8}',
      },
    });

    harness.runUserscript(userSource);

    assert.equal(harness.pageWindow.__TAMPERED_EXECUTED, undefined, `${manager}: tampered cache executed in page world`);
    assert.equal(harness.scriptWindow.__TAMPERED_EXECUTED, undefined, `${manager}: tampered cache executed in script world`);
    assert.equal(harness.doc.documentElement.dataset.spotplusCompanion, COMPANION_VERSION);
    assert.equal(harness.mountedVersionText(), `Helper ${COMPANION_VERSION}`);
    assert.deepEqual(harness.evalCalls, []);
    assert.deepEqual(harness.fetchCalls, []);

    const stored = harness.localStore.snapshot();
    assert.equal(Object.hasOwn(stored, 'spotplus.helperCore'), false, `${manager}: stale helperCore key not removed`);
    assert.equal(Object.hasOwn(stored, 'spotplus.helperCoreAt'), false, `${manager}: stale helperCoreAt key not removed`);
    assert.equal(stored['spotplus.syncKey'], syncKey, `${manager}: syncKey must be preserved`);
    assert.equal(stored['spotplus.syncAt'], '1700000000000', `${manager}: syncAt must be preserved`);
    assert.equal(stored['spotify.user.pref'], '{"volume":0.8}', `${manager}: Spotify storage must be preserved`);
  }
});

test('stale cached version never causes rollback to an older helper version', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');
  const stalePayload = '/*spotplus-helper-core*/(()=>{document.documentElement.dataset.spotplusCompanion="1.6.0";window.__OLD_VERSION_RAN=true;})();';
  const harness = createManagerHarness({
    manager: 'safari-userscripts',
    initialLocalStorage: {
      'spotplus.helperCore': stalePayload,
      'spotplus.helperCoreAt': '1000',
      'spotplus.syncKey': 'b'.repeat(64),
    },
  });

  harness.runUserscript(userSource);

  assert.equal(harness.pageWindow.__OLD_VERSION_RAN, undefined);
  assert.equal(harness.doc.documentElement.dataset.spotplusCompanion, COMPANION_VERSION);
  assert.equal(harness.mountedVersionText(), `Helper ${COMPANION_VERSION}`);
  assert.equal(harness.localStore.getItem('spotplus.helperCore'), null);
  assert.equal(harness.localStore.getItem('spotplus.syncKey'), 'b'.repeat(64));
});

test('corrupt cache payloads and throwing localStorage implementations fail safe and still boot packaged helper', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');

  const corruptValues = [
    '/*spotplus-helper-core*/function broken( {{{',
    '\0\uFFFDbinary-garbage',
    '',
    '{"unexpected":"json"}',
  ];

  for (const corrupt of corruptValues) {
    const harness = createManagerHarness({
      manager: 'violentmonkey-content',
      initialLocalStorage: {
        'spotplus.helperCore': corrupt,
        'spotplus.helperCoreAt': 'not-a-timestamp',
        'spotplus.syncKey': 'c'.repeat(64),
      },
    });
    harness.runUserscript(userSource);
    assert.equal(harness.doc.documentElement.dataset.spotplusCompanion, COMPANION_VERSION);
    assert.equal(harness.mountedVersionText(), `Helper ${COMPANION_VERSION}`);
    assert.equal(harness.localStore.getItem('spotplus.helperCore'), null);
    assert.equal(harness.localStore.getItem('spotplus.helperCoreAt'), null);
    assert.equal(harness.localStore.getItem('spotplus.syncKey'), 'c'.repeat(64));
  }

  for (const storageFailure of [{storageGetterThrows: true}, {storageRemoveThrows: true}]) {
    const harness = createManagerHarness({
      manager: 'safari-userscripts',
      ...storageFailure,
    });
    assert.doesNotThrow(() => harness.runUserscript(userSource));
    assert.equal(harness.doc.documentElement.dataset.spotplusCompanion, COMPANION_VERSION);
    assert.equal(harness.mountedVersionText(), `Helper ${COMPANION_VERSION}`);
  }
});

test('offline startup runs packaged helper immediately with zero network fetches', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');
  const harness = createManagerHarness({
    manager: 'safari-userscripts',
    offline: true,
    initialLocalStorage: {'spotplus.syncKey': 'd'.repeat(64)},
  });

  harness.runUserscript(userSource);

  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(harness.doc.documentElement.dataset.spotplusCompanion, COMPANION_VERSION);
  assert.equal(harness.mountedVersionText(), `Helper ${COMPANION_VERSION}`);
  assert.equal(harness.localStore.getItem('spotplus.syncKey'), 'd'.repeat(64));
});

test('upgraded cache from 1.7.0 removes legacy keys while preserving syncKey, bridge session, and Spotify keys', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');
  const syncKey = 'e'.repeat(64);
  const bridge = JSON.stringify({nonce: 'f'.repeat(32), origin: 'https://coye2.github.io', started: Date.now()});

  const harness = createManagerHarness({
    manager: 'tampermonkey-raw',
    initialLocalStorage: {
      'spotplus.helperCore': '/*spotplus-helper-core*/(()=>{/* 1.7.0 cached core */})();',
      'spotplus.helperCoreAt': String(Date.now() - 1000),
      'spotplus.syncKey': syncKey,
      'spotplus.syncAt': '1710000000000',
      'sp_dc_ui_theme': 'dark',
    },
    initialSessionStorage: {
      'spotplus.bridge': bridge,
    },
  });

  harness.runUserscript(userSource);

  assert.equal(harness.doc.documentElement.dataset.spotplusCompanion, COMPANION_VERSION);
  assert.deepEqual(harness.localStore.snapshot(), {
    'spotplus.syncKey': syncKey,
    'spotplus.syncAt': '1710000000000',
    'sp_dc_ui_theme': 'dark',
  });
  assert.equal(harness.sessionStore.getItem('spotplus.bridge'), bridge);
});

test('supported managers inject into page world under CSP, handle document-start before <html>, and clean up blob URLs', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');

  // 1. Safari Userscripts: inline blocked by Spotify CSP -> blob: script executes in page world & hooks page fetch.
  const safari = createManagerHarness({manager: 'safari-userscripts'});
  const originalPageFetch = safari.pageWindow.fetch;
  safari.runUserscript(userSource);
  assert.deepEqual(safari.injectedMethods, ['inline-blocked', 'blob']);
  assert.equal(safari.revokedUrls.length, 1);
  assert.notEqual(safari.pageWindow.fetch, originalPageFetch, 'Safari blob injection must hook page-world window.fetch');
  assert.equal(safari.mountedVersionText(), `Helper ${COMPANION_VERSION}`);

  // 2. Violentmonkey at document-start before <html> exists -> MutationObserver waits, then injects via blob:.
  const violent = createManagerHarness({manager: 'violentmonkey-content', delayDocumentElement: true});
  const violentPageFetch = violent.pageWindow.fetch;
  violent.runUserscript(userSource);
  assert.deepEqual(violent.injectedMethods, []);
  violent.attachDocumentElement();
  assert.deepEqual(violent.injectedMethods, ['inline-blocked', 'blob']);
  assert.equal(violent.revokedUrls.length, 1);
  assert.notEqual(violent.pageWindow.fetch, violentPageFetch);
  assert.equal(violent.mountedVersionText(), `Helper ${COMPANION_VERSION}`);

  // 3. Strictest CSP blocking inline AND blob: -> runs packaged function directly without eval.
  const strict = createManagerHarness({manager: 'strict-csp-no-blob'});
  const strictFetch = strict.pageWindow.fetch;
  strict.runUserscript(userSource);
  assert.deepEqual(strict.injectedMethods, ['inline-blocked', 'blob-blocked']);
  assert.deepEqual(strict.evalCalls, []);
  assert.notEqual(strict.pageWindow.fetch, strictFetch);
  assert.equal(strict.mountedVersionText(), `Helper ${COMPANION_VERSION}`);

  // 4. Duplicate execution is idempotent.
  strict.runUserscript(userSource);
  assert.equal(strict.doc.body.children.filter(c => c.id === 'spotplus-companion').length, 1);
});

test('subframes and non-Spotify origins abort without executing or mutating localStorage', async () => {
  const userSource = await readFile(USER_SCRIPT_URL, 'utf8');

  for (const cfg of [{inFrame: true}, {origin: 'https://evil.example'}]) {
    const harness = createManagerHarness({
      manager: 'tampermonkey-raw',
      ...cfg,
      initialLocalStorage: {'spotplus.helperCore': 'untouched', 'spotplus.syncKey': '1'.repeat(64)},
    });
    harness.runUserscript(userSource);
    assert.equal(harness.doc.documentElement.dataset.spotplusCompanion, undefined);
    assert.equal(harness.mountedVersionText(), null);
    assert.equal(harness.localStore.getItem('spotplus.helperCore'), 'untouched');
    assert.equal(harness.localStore.getItem('spotplus.syncKey'), '1'.repeat(64));
  }
});
