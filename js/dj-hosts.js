export const HOSTS=[
 {id:'afterhours',name:'After Hours',description:'Relaxed, low-key delivery'},
 {id:'daylight',name:'Daylight',description:'Warm, bright delivery'},
 {id:'classic',name:'Classic',description:'Easygoing radio host'},
];
export const PHRASES={preview:"Alright. You're with Spot Plus. Tell me what you're feeling, and let's find something good."};
export const validHost=id=>HOSTS.some(h=>h.id===id)?id:'afterhours';
export function clipUrl(host,cue){return Object.hasOwn(PHRASES,cue)?new URL('../audio/dj/'+validHost(host)+'/'+cue+'.mp3',import.meta.url).href:null;}
