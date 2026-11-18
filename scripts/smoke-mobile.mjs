// Real 390×844 touch-layout smoke test of the production build.
// Run by .github/workflows/mobile-smoke.yml (Playwright's Chromium mobile emulation).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

const port = '47081';
const host = 'http://127.0.0.1:' + port + '/';
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
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const ctx=await browser.newContext({
    viewport:{width:390,height:844},screen:{width:390,height:844},
    deviceScaleFactor:3,hasTouch:true,isMobile:true,serviceWorkers:'block',
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  });
  await ctx.addInitScript(()=>{
    try{
      localStorage.setItem('spotplus.landing','1');
      localStorage.setItem('spotplus.onboarded.v2','1');
      localStorage.setItem('spotplus.onboarded.v2.installed','1');
    }catch{}
    Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
  });
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(host+'#/backgrounds',{waitUntil:'domcontentloaded'});
  await page.locator('#bgList').waitFor({timeout:30000});
  await page.waitForTimeout(750);
  const layout=await page.evaluate(()=>{
    const main=document.querySelector('main'),list=document.querySelector('#bgList');
    const b=list.getBoundingClientRect();
    return {viewport:[innerWidth,innerHeight],rows:list.querySelectorAll('.bg-catalog-body [data-act="bg-pick"]').length,
      listHeight:list.clientHeight,listTop:b.top,listBottom:b.bottom,
      listScrollHeight:list.scrollHeight,mainScrollTop:main.scrollTop,
      barTop:document.querySelector('.bar')?.getBoundingClientRect().top,
      navTop:document.querySelector('.nav')?.getBoundingClientRect().top,
      listOverflow:getComputedStyle(list).overflowY,
    };
  });
  console.log('Mobile wallpaper layout:',JSON.stringify(layout));
  assert.equal(layout.viewport[0],390);
  assert.equal(layout.viewport[1],844);
  assert.ok(layout.rows>=2600,'The full wallpaper catalog must render');
  assert.ok(layout.listHeight>=220,'Wallpaper list must be useful on iPhone, not a tiny strip');
  assert.ok(layout.listScrollHeight>layout.listHeight*5,'Wallpaper list must be internally scrollable');
  assert.equal(layout.mainScrollTop,0,'Main must stay still');
  assert.equal(layout.listOverflow,'auto');
  assert.ok(layout.listBottom<=Math.min(layout.barTop,layout.navTop)+2,'List must end above bars');
  await page.mouse.move(190,Math.min(layout.listTop+65,layout.listBottom-12));
  await page.mouse.wheel(0,800);
  await page.waitForTimeout(350);
  const scrolled=await page.evaluate(()=>({main:document.querySelector('main').scrollTop,list:document.querySelector('#bgList').scrollTop}));
  assert.equal(scrolled.main,0,'Main scrolled instead of the wallpaper list');
  assert.ok(scrolled.list>0,'Mouse/touch-equivalent scroll failed');
  const lastRow=await page.evaluate(()=>{
    const list=document.querySelector('#bgList');
    list.scrollTop=list.scrollHeight;
    const last=list.querySelector('tbody:last-of-type tr:last-child');
    return {list: list.scrollTop, lastBottom:last?.getBoundingClientRect().bottom,listBottom:list.getBoundingClientRect().bottom};
  });
  assert.ok(lastRow.list>0,'Cannot reach the catalog end');
  assert.ok(lastRow.lastBottom<=lastRow.listBottom+2,'Last wallpaper is clipped');
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
