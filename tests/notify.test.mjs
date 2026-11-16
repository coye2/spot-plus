import test from 'node:test';
import assert from 'node:assert/strict';
import {canSend,markSent,pickNewReleases,releaseMessage,weeklyRecap,DAILY_CAP} from '../js/notify.js';

const noon=new Date(2026,10,16,12).getTime(), night=new Date(2026,10,16,23).getTime();
test('daily cap, per-kind gap and quiet hours keep it calm',()=>{
  let st={};
  assert.equal(canSend(st,'release',noon),true);
  st=markSent(st,'release',noon);
  assert.equal(canSend(st,'release',noon+3600000),false,'one release note per day');
  assert.equal(canSend(st,'stats',noon+3600000),true);
  st=markSent(st,'stats',noon+3600000);
  assert.equal(canSend(st,'update',noon+7200000),false,`cap of ${DAILY_CAP}`);
  assert.equal(canSend({},'release',night),false,'quiet at night');
  assert.equal(canSend({},'update',night,{visible:true}),true,'in-app is fine');
});
test('first sight of an artist never notifies; later releases do',()=>{
  const now=Date.parse('2026-11-16');
  const first=pickNewReleases({},{1:[{id:9,title:'Old',artist:'A',released:'2026-11-10',type:'album'}]},now);
  assert.equal(first.fresh.length,0);
  const next=pickNewReleases(first.seen,{1:[{id:10,title:'New',artist:'A',released:'2026-11-14',type:'single'},{id:9,title:'Old',artist:'A',released:'2026-11-10'}]},now);
  assert.deepEqual(next.fresh.map(r=>r.id),[10]);
  assert.equal(releaseMessage(next.fresh).title,'New single from A');
  const future=pickNewReleases(next.seen,{1:[{id:11,title:'Soon',artist:'A',released:'2026-12-01'}]},now);
  assert.equal(future.fresh.length,0,'unreleased albums wait');
});
test('weekly recap needs real listening',()=>{
  const now=Date.now();
  assert.equal(weeklyRecap([{endedAt:now-1000,ms:60000,artist:'A'}],now),null);
  const r=weeklyRecap([{endedAt:now-1000,ms:40*60000,artist:'B'},{endedAt:now-2000,ms:5*60000,artist:'A'}],now);
  assert.match(r.body,/45 minutes · Most played: B/);
});
