import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fitWallpaperList} from '../js/backgrounds.js';
import {shouldRefreshPhoto} from '../js/profile-photo.js';
import {MODES} from '../js/themes.js';
import {CHANGELOG} from '../js/changelog.js';

test('1.9.22 release and its iOS features stay paired', async () => {
  const [pkg,sw,css,html,app] = await Promise.all([
    readFile('package.json','utf8').then(JSON.parse),
    readFile('sw.js','utf8'),
    readFile('css/backgrounds.css','utf8'),
    readFile('index.html','utf8'),
    readFile('js/app.js','utf8'),
  ]);
  assert.equal(pkg.version,'1.9.22');
  assert.equal(CHANGELOG[0].version,pkg.version);
  assert.match(sw,/spotplus-shell-v95/);
  assert.match(sw,/['"]\.\/js\/profile-photo\.js['"]/);
  for(const selector of ['#homeDJPrompt','#globalQ','#q','#libraryQ','#pageLibraryQ','#folderQ','#djPrompt','#bgSearch']) assert.ok(css.includes(selector),selector);
  assert.match(css,/-webkit-appearance:none!important/);
  assert.match(css,/body\[data-chrome=clear\]/);
  assert.ok(MODES.includes('clear'));
  assert.match(html,/id="profilePhotoInput"/);
  assert.match(app,/avatar:spotifyPhoto\(\)/); // Jam never receives a blob: URL.
  assert.match(app,/profile-photo-spotify/);
});

test('wallpaper swipes are not stolen by the page rubber-band', async () => {
  const shell = await readFile(new URL('../js/shell.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/backgrounds.css', import.meta.url), 'utf8');
  assert.match(shell, /dataset\.page === 'backgrounds'/);
  assert.match(shell, /#bgList/);
  assert.match(css, /body\[data-page="backgrounds"\] main/);
  assert.match(css, /-webkit-overflow-scrolling:auto !important/);
});

test('wallpaper picker uses a real pixel scroll viewport below bars on 390x844', () => {
  const original = {document:globalThis.document,getComputedStyle:globalThis.getComputedStyle,innerHeight:globalThis.innerHeight,visualViewport:globalThis.visualViewport};
  const wrap = {style:{},scrollTop:0,getBoundingClientRect:()=>({top:275})};
  const main = {scrollTop:99,getBoundingClientRect:()=>({bottom:844})};
  const nav = {hidden:false,getBoundingClientRect:()=>({top:780})};
  const bar = {hidden:false,getBoundingClientRect:()=>({top:720})};
  globalThis.document = {querySelector:key=>key==='main'?main:key==='.nav'?nav:key==='.bar'?bar:null};
  globalThis.getComputedStyle = node=>({paddingBottom:node===main?'160px':'0px',display:'block'});
  globalThis.innerHeight = 844;
  globalThis.visualViewport = {height:844};
  try {
    const height = fitWallpaperList({querySelector:()=>wrap});
    assert.equal(height,401);
    assert.equal(wrap.style.height,'401px');
    assert.equal(wrap.style.flex,'0 0 401px');
    wrap.scrollTop = 150;
    assert.equal(main.scrollTop,0);
    assert.equal(wrap.scrollTop,150);
  } finally {
    for(const [k,v] of Object.entries(original)) if(v===undefined)delete globalThis[k];else globalThis[k]=v;
  }
});

test('device photo refresh only accepts Spotify user IDs and honors its daily cadence', () => {
  const now=Date.UTC(2026,10,18);
  assert.equal(shouldRefreshPhoto({id:'user_1',avatar:'',now}),true);
  assert.equal(shouldRefreshPhoto({id:'user_1',avatar:'https://spotify.test/photo',checkedAt:now-1000,now}),false);
  assert.equal(shouldRefreshPhoto({id:'user_1',avatar:'https://spotify.test/photo',checkedAt:now-86400001,now}),true);
  assert.equal(shouldRefreshPhoto({id:'https://unsafe',now}),false);
});
