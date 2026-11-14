export const presets=[
 {id:'pine',name:'Winter Pine',note:'AMOLED · evergreen',accent:'#1b5e46',surface:'#090e0b',raised:'#15231b'},
 {id:'obsidian',name:'Obsidian',note:'Black · silver',accent:'#a9b0ae',surface:'#0a0a0a',raised:'#1e1e1e'},
 {id:'glacier',name:'Glacier',note:'Black · glacial blue',accent:'#315b76',surface:'#080f16',raised:'#142432'},
 {id:'ember',name:'Ember',note:'Carbon · copper',accent:'#803e28',surface:'#120c09',raised:'#291b13'},
 {id:'orchid',name:'Night Orchid',note:'Black · muted violet',accent:'#604080',surface:'#0f0b15',raised:'#21172d'},
 {id:'cobalt',name:'After Hours',note:'Black · deep cobalt',accent:'#2b4589',surface:'#080d19',raised:'#17233d'}
];
export const validHex=x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x);
const rgb=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16));
export function mix(a,b,n){const x=rgb(a),y=rgb(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*n).toString(16).padStart(2,'0')).join('');}
export function luminance(hex){return rgb(hex).map(x=>{const c=x/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);}
export function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function palette(settings={}){
  const chosen=presets.find(x=>x.id===settings.themePreset)||presets.find(x=>x.id===(settings.accent==='violet'?'orchid':settings.accent==='white'?'obsidian':'pine'));
  const custom=settings.themeCustom||{},accent=validHex(custom.accent)?custom.accent:chosen.accent;
  const darken=color=>{for(let i=0;i<20&&luminance(color)>.12;i++)color=mix(color,'#000000',.15);return color;};
  const surface=darken(validHex(custom.surface)?custom.surface:chosen.surface),raised=darken(validHex(custom.raised)?custom.raised:chosen.raised);
  let accentText=mix(accent,'#ffffff',.56);for(let i=0;i<30&&contrast(accentText,raised)<4.5;i++)accentText=mix(accentText,'#ffffff',.1);
  return {...chosen,accent,surface,raised,accentText,ink:contrast(accent,'#ffffff')>=contrast(accent,'#000000')?'#ffffff':'#000000',canvas:settings.amoled===false?'#080a09':'#000000',radius:Math.max(0,Math.min(24,Number(settings.cornerRadius??8)||0)),line:mix(raised,'#ffffff',.12)};
}
export function applyTheme(settings){
  const p=palette(settings),root=document.documentElement;
  for(const [key,value]of Object.entries({'--canvas':p.canvas,'--bg':p.canvas,'--bg2':p.surface,'--bg3':p.raised,'--accent':p.accent,'--accent2':p.accent,'--accent-text':p.accentText,'--accent-ink':p.ink,'--line':p.line,'--radius':p.radius+'px'}))root.style.setProperty(key,value);
  document.body.dataset.cover=settings.coverStyle||'square';document.body.dataset.theme=p.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',p.canvas);
  return p;
}
export function normalizeTheme(data){
  if(!data||data.app!=='spotplus-theme')throw new Error('Choose a Spot+ theme file.');
  const p=data.settings||{},colors={};
  for(const key of ['accent','surface','raised']){if(!validHex(p.themeCustom?.[key]))throw new Error('This theme contains an invalid color.');colors[key]=p.themeCustom[key];}
  const settings={themePreset:presets.some(t=>t.id===p.themePreset)?p.themePreset:'pine',themeCustom:colors,amoled:p.amoled!==false,cornerRadius:Math.max(0,Math.min(24,Number(p.cornerRadius)||0)),coverStyle:['square','disc'].includes(p.coverStyle)?p.coverStyle:'square'};
  // Older theme files omit these preferences; do not reset the listener's values.
  for(const [key,allowed]of Object.entries({density:['comfortable','compact'],textSize:['normal','large'],motion:['system','reduced']}))if(allowed.includes(p[key]))settings[key]=p[key];
  return settings;
}
