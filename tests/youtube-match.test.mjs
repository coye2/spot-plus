import test from 'node:test';import assert from 'node:assert/strict';
import {parseSearch,youtubeMatch} from '../canvas-bridge/youtube-match.js';
import {rankAudioMatches} from '../js/audio-selection.js';
const v=(id,title,channel,len,badge)=>({videoRenderer:{videoId:id,title:{runs:[{text:title}]},ownerText:{runs:[{text:channel}]},lengthText:{simpleText:len},...(badge?{ownerBadges:[{}]}:{})}});
const page={contents:{sectionListRenderer:{contents:[{itemSectionRenderer:{contents:[
  v('BwX8OS4cegU','The Weeknd - Blinding Lights (Lyrics)','7clouds Indie','3:21'),
  v('fHI8X4OXluQ','The Weeknd - Blinding Lights (Official Audio)','The Weeknd','3:24',true),
  {shelfRenderer:{}},v('bad','x','y','1:00')]}}]}}};
test('shared lookup parses YouTube results and the app picks the official audio',()=>{
  const items=parseSearch(page);
  assert.equal(items.length,2);
  assert.equal(rankAudioMatches(items,{title:'Blinding Lights',artist:'The Weeknd',duration:200})[0].id,'fHI8X4OXluQ');
});
test('lookups are cached at the edge and bad requests are refused',async()=>{
  const store=new Map(),cache={match:async k=>store.get(k.url)?.clone(),put:async(k,r)=>store.set(k.url,r)};let calls=0;
  const fetcher=async()=>{calls++;return new Response(JSON.stringify(page));};
  const req=()=>new Request('https://b.test/match?q=The%20Weeknd%20Blinding%20Lights');
  const first=await youtubeMatch(req(),{fetcher,cache,waitUntil:p=>p});await new Promise(r=>setTimeout(r,0));
  const second=await youtubeMatch(req(),{fetcher,cache});
  assert.equal(calls,1);assert.equal((await second.json()).items.length,2);assert.equal(first.status,200);
  assert.equal((await youtubeMatch(new Request('https://b.test/match?q=a'),{fetcher})).status,400);
});
