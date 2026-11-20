// Every preset works in light and dark. Signature presets carry hand-tuned dark
// surfaces; Material presets are seed colors expanded into tonal palettes
// (Material You style). A preset's `mode` switches the app to that mode when picked.
export const presets=[
 {id:'pine',name:'Winter Pine',note:'Evergreen',accent:'#1b5e46',surface:'#090e0b',raised:'#15231b'},
 {id:'obsidian',name:'Obsidian',note:'Silver',accent:'#a9b0ae',surface:'#0a0a0a',raised:'#1e1e1e'},
 {id:'glacier',name:'Glacier',note:'Glacial blue',accent:'#315b76',surface:'#080f16',raised:'#142432'},
 {id:'ember',name:'Ember',note:'Copper',accent:'#803e28',surface:'#120c09',raised:'#291b13'},
 {id:'orchid',name:'Night Orchid',note:'Muted violet',accent:'#604080',surface:'#0f0b15',raised:'#21172d'},
 {id:'cobalt',name:'After Hours',note:'Deep cobalt',accent:'#2b4589',surface:'#080d19',raised:'#17233d'},
 {id:'aurora',name:'Aurora',note:'Northern lights',accent:'#2f8f7a',surface:'#06100f',raised:'#0f2523'},
 {id:'midnight-rose',name:'Midnight Rose',note:'Velvet red',accent:'#9a3550',surface:'#120709',raised:'#2a1218'},
 {id:'sunset',name:'Golden Hour',note:'Warm amber',accent:'#b36b1f',surface:'#120c05',raised:'#2a1d0e'},
 {id:'nebula',name:'Nebula',note:'Cosmic purple',accent:'#7a4fd0',surface:'#0b0816',raised:'#1c1533'},
 {id:'lagoon-night',name:'Tidal',note:'Deep teal',accent:'#1f7a8c',surface:'#051012',raised:'#0d2429'},
 {id:'matcha',name:'Matcha',note:'Soft green tea',accent:'#6e8f3a',surface:'#0b0e06',raised:'#1b2210'},
 {id:'sakura',name:'Sakura Night',note:'Cherry blossom',accent:'#c0587e',surface:'#12080d',raised:'#2a1520'},
 {id:'espresso',name:'Espresso',note:'Coffee & cream',accent:'#8c6a4a',surface:'#0e0a07',raised:'#221a13'},
 {id:'neon',name:'Neon City',note:'Electric magenta',accent:'#c02fa8',surface:'#0c0610',raised:'#211029'},
 {id:'arctic',name:'Arctic',note:'Ice white',accent:'#7fa6bf',surface:'#070b0e',raised:'#141d24'},
 {id:'m3-violet',name:'Dynamic Violet',note:'Material',seed:'#6750a4',material:true},
 {id:'m3-ocean',name:'Ocean',note:'Material',seed:'#0061a4',material:true},
 {id:'m3-lagoon',name:'Lagoon',note:'Material',seed:'#006a6a',material:true},
 {id:'m3-fern',name:'Fern',note:'Material',seed:'#386a20',material:true},
 {id:'m3-honey',name:'Honey',note:'Material',seed:'#7d5700',material:true},
 {id:'m3-coral',name:'Coral',note:'Material',seed:'#9c4146',material:true},
 {id:'m3-rose',name:'Rose',note:'Material',seed:'#984061',material:true},
 {id:'m3-indigo',name:'Indigo',note:'Material',seed:'#4355b9',material:true},
 {id:'m3-sage',name:'Sage',note:'Material',seed:'#4c6354',material:true},
 {id:'green',name:'Classic Green',note:'Material',seed:'#1db954',material:true},
 {id:'paper',name:'Paper',note:'Light · warm',seed:'#8a6e4b',material:true,mode:'light'},
 {id:'snow',name:'Snow',note:'Light · cool',seed:'#4f6f8f',material:true,mode:'light'},
 {id:'blossom',name:'Blossom',note:'Light · pink',seed:'#b04a7a',material:true,mode:'light'},
 {id:'linen',name:'Linen',note:'Light · sand',seed:'#9a7b4f',material:true,mode:'light'},
 {id:'mint',name:'Mint',note:'Light · fresh',seed:'#2e8b6a',material:true,mode:'light'},
 {id:'lavender',name:'Lavender',note:'Light · lilac',seed:'#7b5ea7',material:true,mode:'light'},
 {id:'sky',name:'Sky',note:'Light · blue',seed:'#3d7ab8',material:true,mode:'light'},
];
export const MODES=['dark','light','system','clear'];
export const validHex=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
const rgb=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16));
export function mix(a,b,n){const x=rgb(a),y=rgb(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*n).toString(16).padStart(2,'0')).join('');}
export function luminance(hex){return rgb(hex).map(x=>{const c=x/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}
export function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
/* HSL helpers for tonal palettes. Tone = HSL lightness 0..100. */
function toHsl(hex){const [r,g,b]=rgb(hex).map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;let h=0,s=0;if(max!==min){const d=max-min;s=l>.5?d/(2-max-min):d/(max+min);h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;h*=60;}return [h,s,l];}
function fromHsl(h,s,l){const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return '#'+[f(0),f(8),f(4)].map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');}
export function tone(seed,lightness,chroma=1){const [h,s]=toHsl(seed);return fromHsl(h,Math.min(1,s*chroma),lightness/100);}
const systemLight=()=>typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: light)').matches;
export function themeMode(settings={}){
  const chosen=presets.find(x=>x.id===settings.themePreset);
  const mode=MODES.includes(settings.themeMode)?settings.themeMode:chosen?.mode||'dark';
  // Clear keeps dark text colors and paints the chrome transparent over the wallpaper.
  if(mode==='clear')return 'dark';
  return mode==='system'?(systemLight()?'light':'dark'):mode;
}
function readable(color,background,target=4.5,towards){for(let i=0;i<40&&contrast(color,background)<target;i++)color=mix(color,towards,.1);return color;}
export function palette(settings={}){
  const chosen=presets.find(x=>x.id===settings.themePreset)||presets.find(x=>x.id===(settings.accent==='violet'?'orchid':settings.accent==='white'?'obsidian':'pine'));
  const custom=settings.themeCustom||{},mode=themeMode(settings),light=mode==='light';
  const seed=validHex(custom.accent)?custom.accent:chosen.seed||chosen.accent;
  const radius=Math.max(0,Math.min(24,Number(settings.cornerRadius??8)||0));
  let accent,surface,raised,canvas,text,muted;
  if(light){
    accent=validHex(custom.accent)?custom.accent:tone(seed,chosen.material?38:34,1);
    canvas=tone(seed,98.5,.45);surface=validHex(custom.surface)&&luminance(custom.surface)>.6?custom.surface:tone(seed,95.5,.5);raised=validHex(custom.raised)&&luminance(custom.raised)>.5?custom.raised:tone(seed,91,.55);
    text=tone(seed,10,.35);muted=readable(tone(seed,38,.25),surface,4.6,'#000000');
    accent=readable(accent,canvas,4.5,'#000000');
  }else{
    const darken=color=>{for(let i=0;i<20&&luminance(color)>.12;i++)color=mix(color,'#000000',.15);return color;};
    if(chosen.material&&!validHex(custom.accent))accent=tone(seed,72,.9);else accent=validHex(custom.accent)?custom.accent:chosen.accent;
    surface=darken(validHex(custom.surface)?custom.surface:chosen.surface||tone(seed,7,.35));raised=darken(validHex(custom.raised)?custom.raised:chosen.raised||tone(seed,15,.4));
    canvas=settings.amoled===false?(chosen.material?tone(seed,4.5,.3):'#080a09'):'#000000';
    text='#ffffff';muted=readable(tone(seed,72,.12),raised,4.6,'#ffffff');
  }
  let accentText=light?tone(accent,28,1):mix(accent,'#ffffff',.56);
  accentText=readable(accentText,raised,4.5,light?'#000000':'#ffffff');
  const ink=contrast(accent,'#ffffff')>=contrast(accent,'#000000')?'#ffffff':'#000000';
  return {...chosen,mode,accent,surface,raised,canvas,text,muted,accentText,ink,radius,line:mix(raised,light?'#000000':'#ffffff',.12),hover:mix(raised,light?'#000000':'#ffffff',light?.05:.07),contrastBg:light?text:'#ffffff',contrastInk:light?'#ffffff':'#000000'};
}
let lastSettings=null;
export function applyTheme(settings){
  lastSettings=settings;
  const p=palette(settings),root=document.documentElement;
  for(const [key,value]of Object.entries({'--canvas':p.canvas,'--bg':p.canvas,'--bg2':p.surface,'--bg3':p.raised,'--accent':p.accent,'--accent2':p.accent,'--accent-text':p.accentText,'--accent-ink':p.ink,'--line':p.line,'--hover':p.hover,'--text':p.text,'--muted':p.muted,'--contrast':p.contrastBg,'--on-contrast':p.contrastInk,'--radius':p.radius+'px'}))root.style.setProperty(key,value);
  document.body.dataset.cover=settings.coverStyle||'square';document.body.dataset.theme=p.id;document.body.dataset.mode=p.mode;
  const chrome=settings.themeMode==='clear'?'clear':'solid';
  document.body.dataset.chrome=chrome;root.dataset.chrome=chrome;
  root.style.colorScheme=p.mode;root.dataset.mode=p.mode;
  root.style.setProperty('--chrome-color',p.canvas);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',p.canvas);
  try{localStorage.setItem('spotplus.chrome',JSON.stringify({mode:p.mode,canvas:p.canvas,chrome}));}catch{ /* Private mode. */ }
  return p;
}
if(typeof matchMedia==='function')matchMedia('(prefers-color-scheme: light)').addEventListener?.('change',()=>{if(lastSettings?.themeMode==='system')applyTheme(lastSettings);});
export function normalizeTheme(data){
  if(!data||data.app!=='spotplus-theme')throw new Error('Choose a Spot+ theme file.');
  const p=data.settings||{},colors={};
  for(const key of ['accent','surface','raised']){if(!validHex(p.themeCustom?.[key]))throw new Error('This theme contains an invalid color.');colors[key]=p.themeCustom[key];}
  const settings={themePreset:presets.some(t=>t.id===p.themePreset)?p.themePreset:'pine',themeCustom:colors,...(MODES.includes(p.themeMode)?{themeMode:p.themeMode}:{}),amoled:p.amoled!==false,cornerRadius:Math.max(0,Math.min(24,Number(p.cornerRadius)||0)),coverStyle:['square','disc'].includes(p.coverStyle)?p.coverStyle:'square'};
  // Older theme files omit these preferences; do not reset the listener's values.
  for(const [key,allowed]of Object.entries({density:['comfortable','compact'],textSize:['normal','large'],motion:['system','reduced']}))if(allowed.includes(p[key]))settings[key]=p[key];
  return settings;
}
