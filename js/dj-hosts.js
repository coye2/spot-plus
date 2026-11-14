export const HOSTS=[
 {id:'afterhours',name:'After Hours',description:'Relaxed, low-key delivery'},
 {id:'daylight',name:'Daylight',description:'Warm, bright delivery'},
 {id:'classic',name:'Classic',description:'Easygoing radio host'},
];
export const PHRASES={preview:"Alright. You're with Spot Plus. Tell me what you're feeling, and let's find something good.",start:"Alright, let's settle in. A few favorites, a few new discoveries. This is your mix.",request:"Yeah, I got you. Let's take the music in a different direction.",next:"Let's see what's next.",pause:"No rush. I'll keep your place.",resume:"Alright. Back to the music.",like:"Good choice. That one's in your liked songs.",previous:"Let's run that one back.",shuffle_on:"Let's mix things up.",shuffle_off:"Back in order.",discovery:"Stay with me. There's something good coming up.",error:"Didn't catch that one. Try an artist, a song, or a mood.",identify:"Here's what's playing.",empty:"Pick a song, and we'll take it from there."};
export const validHost=id=>HOSTS.some(h=>h.id===id)?id:'afterhours';
export function clipUrl(host,cue){return Object.hasOwn(PHRASES,cue)?new URL('../audio/dj/'+validHost(host)+'/'+cue+'.mp3',import.meta.url).href:null;}
