// Real 390×844 touch-layout smoke test of the production build.
// Run by .github/workflows/mobile-smoke.yml (Playwright's Chromium mobile emulation).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {ALLOWED_ID_HASHES, DEV_ACCESS_STORAGE_KEY, MAINTENANCE_MODE, createSessionToken} from '../js/maintenance.js';
import {APP_VERSION} from '../js/changelog.js';

const {chromium} = await import('playwright').catch(() => import('/usr/local/share/bun-global/node_modules/playwright-core/index.mjs'));

// The worker only answers Spot+'s own site and the local test address on port 8080 (CORS).
const port = '8080';
const origin = 'http://127.0.0.1:' + port;
const host = origin + '/';
const server = spawn(process.execPath, ['scripts/serve.mjs','dist'], {
  env:{...process.env,PORT:port},stdio:['ignore','pipe','pipe'],
});
let logs='';
server.stdout.on('data',data=>{logs+=data.toString();});
server.stderr.on('data',data=>{logs+=data.toString();});
let browser;
try {
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw new Error('Static server stopped: '+logs);
    if(logs.includes('Spot+ http://'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.match(logs,/Spot\+ http:\/\//,'Static server did not start');
  const bundledShell = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
  browser=await chromium.launch({
    headless:true,
    args:['--no-sandbox'],
    ...(existsSync(bundledShell) ? {executablePath: bundledShell} : {}),
  });

  // 1. A public visitor follows the maintenance flag: locked while it is on, and into the app while it is off.
  const guestCtx=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true,isMobile:true,serviceWorkers:'block',
  });
  const guestPage=await guestCtx.newPage();
  await guestPage.goto(host+'#/backgrounds',{waitUntil:'domcontentloaded'});
  if(MAINTENANCE_MODE){
    await guestPage.locator('#maintenanceScreen').waitFor({timeout:15000});
    await guestPage.waitForTimeout(400);
    const guestState=await guestPage.evaluate(()=>({
      appCount:document.querySelectorAll('.app').length,
      screenVisible:!document.getElementById('maintenanceScreen')?.hidden,
      unlockHidden:!!document.getElementById('maintUnlockWrap')?.hidden,
    }));
    assert.equal(guestState.appCount,0,'Public guest must not retain .app nodes');
    assert.equal(guestState.screenVisible,true,'Maintenance screen must be visible for guests');
    assert.equal(guestState.unlockHidden,true,'Unlock form must remain hidden until developer gesture');
  }else{
    await guestPage.waitForFunction(()=>document.documentElement.dataset.maintenance!=='checking'&&document.documentElement.dataset.maintenance!=='1'&&document.querySelector('.app'),{timeout:15000});
    const guestState=await guestPage.evaluate(()=>({
      appCount:document.querySelectorAll('.app').length,
      blocking:document.documentElement.dataset.maintenance==='1'||!!(document.getElementById('maintenanceScreen')&&!document.getElementById('maintenanceScreen').hidden),
    }));
    assert.ok(guestState.appCount>=1,'Public visitor should see the app');
    assert.equal(guestState.blocking,false,'Maintenance screen must stay down');
  }
  await guestCtx.close();

  // 2. Verify full 390x844 authenticated owner session layout, background grid scroll, search & clear.
  const ownerToken=createSessionToken(ALLOWED_ID_HASHES[0],{origin});
  const ctx=await browser.newContext({
    viewport:{width:390,height:844},screen:{width:390,height:844},
    deviceScaleFactor:3,hasTouch:true,isMobile:true,serviceWorkers:'block',
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  });
  await ctx.addInitScript(({key,token,version})=>{
    try{
      localStorage.setItem('spotplus.landing','1');
      localStorage.setItem('spotplus.onboarded.v2','1');
      localStorage.setItem('spotplus.onboarded.v2.installed','1');
      localStorage.setItem('spotplus.seenVersion',version);
      if(token)localStorage.setItem(key,token);
    }catch{}
    Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
  },{key:DEV_ACCESS_STORAGE_KEY,token:ownerToken,version:APP_VERSION});
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(host+'#/backgrounds',{waitUntil:'domcontentloaded'});
  await page.locator('#bgList').waitFor({timeout:30000});
  // A phone loads portrait wallpapers from Alpha Coders instead of the built-in landscape catalog.
  await page.locator('#bgList .bg-card').first().waitFor({timeout:20000});
  const layout=await page.evaluate(()=>{
    const main=document.querySelector('main'),list=document.querySelector('#bgList');
    const b=list.getBoundingClientRect();
    return {viewport:[innerWidth,innerHeight],rows:list.querySelectorAll('.bg-card').length,
      listHeight:list.clientHeight,listTop:b.top,listBottom:b.bottom,
      listScrollHeight:list.scrollHeight,mainScrollTop:main.scrollTop,
      barTop:(()=>{const bar=document.querySelector('.bar');return bar&&!bar.hidden&&getComputedStyle(bar).display!=='none'?bar.getBoundingClientRect().top:Infinity;})(),
      navTop:document.querySelector('.nav')?.getBoundingClientRect().top,
      listOverflow:getComputedStyle(list).overflowY,
    };
  });
  console.log('Mobile wallpaper layout:',JSON.stringify(layout));
  assert.equal(layout.viewport[0],390);
  assert.equal(layout.viewport[1],844);
  assert.ok(layout.rows>=1,'The first phone wallpapers must render');
  assert.match(await page.locator('#bgStatus').textContent(),/phone wallpaper/i,'Status must count the phone wallpapers');
  assert.ok(layout.listHeight>=220,'Wallpaper list must be useful on iPhone, not a tiny strip');
  assert.ok(layout.listScrollHeight>layout.listHeight,'Wallpaper list must be internally scrollable');
  assert.equal(layout.mainScrollTop,0,'Main must stay still');
  assert.equal(layout.listOverflow,'scroll');
  assert.ok(layout.listBottom<=Math.min(layout.barTop ?? 844,layout.navTop)+2,'List must end above bars');
  await page.mouse.move(190,Math.min(layout.listTop+65,layout.listBottom-12));
  await page.mouse.wheel(0,800);
  await page.waitForTimeout(350);
  const scrolled=await page.evaluate(()=>({main:document.querySelector('main').scrollTop,list:document.querySelector('#bgList').scrollTop}));
  assert.equal(scrolled.main,0,'Main scrolled instead of the wallpaper list');
  assert.ok(scrolled.list>0,'Mouse/touch-equivalent scroll failed');
  const lastRow=await page.evaluate(()=>{
    const list=document.querySelector('#bgList');
    list.scrollTop=list.scrollHeight;
    const last=list.querySelector('.bg-card:last-of-type');
    return {list: list.scrollTop, lastBottom:last?.getBoundingClientRect().bottom,listBottom:list.getBoundingClientRect().bottom};
  });
  assert.ok(lastRow.list>0,'Cannot reach the catalog end');
  assert.ok(lastRow.lastBottom<=lastRow.listBottom+2,'Last wallpaper is clipped');

  // Search asks Alpha Coders for phone wallpapers, then Clear brings the browse list back.
  await page.fill('#bgSearch','sunset');
  await page.waitForFunction(()=>/sunset/i.test(document.querySelector('#bgStatus')?.textContent||'')&&document.querySelectorAll('#bgList .bg-card').length>0,{timeout:20000});
  const filtered=await page.evaluate(()=>({
    count:document.querySelectorAll('#bgList .bg-card').length,
    clearHidden:document.getElementById('bgSearchClear')?.hidden,
    mainScroll:document.querySelector('main').scrollTop,
  }));
  assert.ok(filtered.count>0,'Wallpaper search must show matches');
  assert.equal(filtered.clearHidden,false,'Clear search button must appear when query is set');
  assert.equal(filtered.mainScroll,0,'Searching wallpapers must not scroll main');
  await page.click('#bgSearchClear');
  await page.waitForFunction(()=>!/sunset/i.test(document.querySelector('#bgStatus')?.textContent||'')&&document.querySelectorAll('#bgList .bg-card').length>0,{timeout:20000});

  // Check the *input itself* has no background, border, or native search control chrome.
  for(const [route,id] of [['#/home','homeDJPrompt'],['#/search','q'],['#/library','pageLibraryQ']]){
    await page.goto(host+route,{waitUntil:'domcontentloaded'});
    await page.locator('#'+id).waitFor({timeout:30000});
    const style=await page.locator('#'+id).evaluate(input=>{
      const s=getComputedStyle(input);
      return {appearance:s.appearance,background:s.backgroundColor,border:s.borderTopWidth};
    });
    console.log('Input',id,JSON.stringify(style));
    assert.equal(style.appearance,'none',id+' native control still visible');
    assert.equal(style.background,'rgba(0, 0, 0, 0)',id+' has an inner background');
    assert.equal(style.border,'0px',id+' has an inner border');
  }
  await page.goto(host+'#/backgrounds',{waitUntil:'domcontentloaded'});
  await page.locator('#bgSearch').waitFor({timeout:30000});
  await page.evaluate(()=>{
    document.body.dataset.chrome='clear';document.body.dataset.scene='on';
  });
  const clear=await page.evaluate(()=>{
    const v=node=>getComputedStyle(document.querySelector(node)).backgroundColor;
    return {main:v('main'),nav:v('.nav'),bar:v('.bar')};
  });
  console.log('Clear theme:',JSON.stringify(clear));
  assert.equal(clear.main,'rgba(0, 0, 0, 0)','Clear wallpaper blocked by main background');
  assert.ok(clear.nav==='rgb(5, 10, 12)' || clear.nav==='rgba(5, 10, 12, 0.96)','Tab bar must be near-solid');
  await page.goto(host+'#/profile',{waitUntil:'domcontentloaded'});
  await page.locator('[data-act="profile-photo-change"]').first().waitFor({timeout:30000});
  assert.equal(await page.locator('#profilePhotoInput').count(),1);
  await page.screenshot({path:'/tmp/spotplus-mobile-profile.png'});
  assert.equal(errors.length,0,'Browser JS exceptions: '+errors.join(' | '));
  console.log('390×844 mobile smoke PASS');
} finally {
  await browser?.close().catch(()=>{});
  server.kill();
}
