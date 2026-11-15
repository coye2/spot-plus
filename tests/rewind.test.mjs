import test from 'node:test';import assert from 'node:assert/strict';
import {parseHistory,summarizeHistory,ListeningMeter} from '../js/listening-history.js';
test('Spotify history formats normalize without private device/IP fields or podcasts',()=>{
 const basic=parseHistory([{endTime:'2024-02-04 12:30',artistName:'Artist',trackName:'Song',msPlayed:90000}]);
 const extended=parseHistory([{ts:'2024-02-04T12:30:00Z',master_metadata_album_artist_name:'Artist',master_metadata_track_name:'Song',ms_played:90000,ip_addr:'private',platform:'private'},{ts:'2024-02-04T12:30:00Z',episode_name:'Podcast',ms_played:90000}]);
 assert.deepEqual(basic,extended);assert.equal(extended.length,1);assert.equal('ip_addr' in extended[0],false);assert.equal(new Set([...basic,...extended].map(r=>r.id)).size,1);
});
test('Rewind filters dates and sources, ranks minutes and counts 30-second plays',()=>{
 const base={source:'spotify',endedAt:new Date(2024,1,4,12).getTime(),artist:'Artist',title:'Song',ms:90000};
 const records=[base,{...base,ms:10000},{...base,source:'spotplus',ms:180000},{...base,endedAt:new Date(2025,1,4).getTime(),ms:20000}];
 const stats=summarizeHistory(records,{source:'spotify',year:'2024',month:'1'});assert.equal(stats.ms,100000);assert.equal(stats.plays,1);assert.equal(stats.days,1);assert.equal(stats.months[1],100000);assert.equal(stats.tracks.length,1);
});
test('listening meter excludes seeks and paused time and separates repeat sessions',()=>{
 const saved=[];const meter=new ListeningMeter(r=>saved.push(r)),track={id:'song',title:'Song',artist:'Artist'};
 meter.tick(track,{time:0,playing:true,now:0,wall:1000});meter.tick(track,{time:5,playing:true,now:5000,wall:6000});meter.tick(track,{time:100,playing:true,now:6000,wall:7000});meter.tick(track,{time:105,playing:false,now:11000,wall:12000});meter.tick(track,{time:105,playing:false,now:21000,wall:22000});
 assert.equal(saved.at(-1).ms,10000);
 meter.tick(track,{sessionKey:'repeat2',time:0,playing:true,now:22000,wall:23000});meter.tick(track,{sessionKey:'repeat2',time:3,playing:false,now:25000,wall:26000});assert.equal(saved.at(-1).ms,3000);assert.notEqual(saved[0].id,saved.at(-1).id);
 meter.reset();meter.tick(track,{time:3,playing:true,now:26000,wall:27000});meter.tick(track,{time:5,playing:false,now:28000,wall:29000});assert.equal(saved.at(-1).ms,2000);
});
