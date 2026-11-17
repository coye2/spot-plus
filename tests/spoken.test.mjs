import test from 'node:test';import assert from 'node:assert/strict';
import {parseFeed,durationSeconds} from '../canvas-bridge/podcasts.js';
import {browserMocks} from './helpers.mjs';browserMocks();
const spoken=await import('../js/spoken.js');
const xml=`<rss><channel><title><![CDATA[My Show]]></title><itunes:author>Host &amp; Co</itunes:author><itunes:image href="https://img.example/s.jpg"/><description>About</description>
<item><title>Ep 2</title><guid>g2</guid><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate><itunes:duration>1:02:03</itunes:duration><enclosure url="https://cdn.example/2.mp3" type="audio/mpeg"/></item>
<item><title>No audio</title></item>
<item><title>Ep 1</title><guid>g1</guid><itunes:duration>754</itunes:duration><enclosure url="javascript:alert(1)" type="audio/mpeg"/></item></channel></rss>`;
test('podcast feeds become clean episode lists',()=>{
  const s=parseFeed(xml,'https://feed.example/rss');
  assert.equal(s.title,'My Show');assert.equal(s.author,'Host & Co');assert.equal(s.episodes.length,1,'items without safe audio are dropped');
  assert.equal(s.episodes[0].duration,3723);assert.equal(durationSeconds('754'),754);
});
test('where you left off: resumes a few seconds back, not after finishing',()=>{
  const t=spoken.episodeTrack({id:'g2',title:'Ep 2',url:'https://cdn.example/2.mp3',duration:3723},{title:'My Show',feed:'f'});
  assert.ok(spoken.isSpoken(t));assert.equal(t.direct,'https://cdn.example/2.mp3');
  spoken.saveProgress(t,600,3723);assert.equal(spoken.resumeAt(t),595);
  spoken.saveProgress(t,3700,3723);assert.equal(spoken.resumeAt(t),0);
});
test('podcast directory falls back to Fyyd when Apple endpoints fail',async()=>{
  const {podcasts}=await import('../canvas-bridge/podcasts.js');
  const fetcher=async url=>{
    if(String(url).includes('apple.com'))return new Response('blocked',{status:403});
    return new Response(JSON.stringify({data:[{id:42,title:'Fallback Show',author:'Host',imgURL:'https://img.example/p.jpg',xmlURL:'https://feed.example/rss',episode_count:12}]}));
  };
  const top=await (await podcasts(new Request('https://bridge.test/podcasts'),{fetcher})).json();
  assert.equal(top.shows.length,1);assert.equal(top.shows[0].title,'Fallback Show');assert.equal(top.shows[0].feed,'https://feed.example/rss');
  const prevFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url).includes('workers.dev'))return new Response(JSON.stringify({error:'Source unavailable'}),{status:503});
    return new Response(JSON.stringify({data:[{id:99,title:'Client Fallback',author:'Host',imgURL:'https://img.example/c.jpg',xmlURL:'https://feed.example/c.xml',episode_count:5}]}));
  };
  try{
    const shows=await spoken.searchShows('tech');
    assert.equal(shows.length,1);assert.equal(shows[0].title,'Client Fallback');
  }finally{globalThis.fetch=prevFetch;}
});
