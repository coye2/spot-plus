import * as api from './api.js';
import * as store from './store.js';
import * as player from './player.js';
import * as localModel from './local-model.js';
import * as voice from './dj-voice.js';
import * as liveVoice from './live-voice.js';
import {isConversation} from './dj-dialogue.js';
import { visibleTracks } from './library.js';
export {localModel,voice,liveVoice};
const conversation=[];
export const liveReady=()=>liveVoice.state.phase==='ready'&&['ready','thinking'].includes(localModel.status.phase);
export async function enableLive(){await liveVoice.load();await localModel.load();state.message='Live DJ is ready. Ask me anything about your music or your mood.';emit();}
export function disableLive(){stop();liveVoice.release();localModel.release();conversation.length=0;}
export const state={busy:false,active:false,tracks:[],message:'Your favorites. Fresh discoveries. Just say the word.',engine:'Quick mix',request:'',seed:0};
const listeners=new Set();let requestToken=0,announced='',trackCount=0;
export const onChange=fn=>listeners.add(fn);
function emit(){listeners.forEach(fn=>fn(state));}
export function fallbackQuery(prompt){return String(prompt).trim().replace(/^(?:hey|hi)[,!]?\s+/i,'').replace(/^(?:can|could|would|will) you\s+/i,'').replace(/^(?:please\s+)?(?:play|give me|put on|find me|i want|i'd like)\s+(?:some\s+)?/i,'').slice(0,120);}
export function uniqueTracks(tracks){return [...new Map(tracks.filter(t=>t?.id).map(t=>[String(t.id),t])).values()];}
export function parseCommand(text){
 const q=String(text).toLowerCase().trim().replace(/[.!?]+$/,'').replace(/^(?:hey|hi)[,!]?\s+/,'').replace(/^(?:can|could|would|will) you\s+/,'').replace(/^please\s+|\s+please$/g,'');
 if(/^(pause|stop)( (the )?music)?$/.test(q))return {type:'pause'};
 if(/^(resume|continue|play)( (the )?music)?$/.test(q))return {type:'resume'};
 if(/^(skip( (this|it|song|track))?|next( (song|track))?)$/.test(q))return {type:'next'};
 if(/^(go back|previous( (song|track))?)$/.test(q))return {type:'prev'};
 if(/^shuffle( (on|off))?$/.test(q))return {type:'shuffle',enabled:!q.endsWith('off')};
 if(/^(like|save)( this| this song| this track)?$/.test(q))return {type:'like'};
 if(/^(what('s| is) (this|playing)|name (this|the song))$/.test(q))return {type:'identify'};
 if(/^(change (it up|the music)|something different|switch it up)$/.test(q))return {type:'change'};
 return null;
}
async function command(action){
 let response='';
 if(action.type==='pause'){player.el.pause();response='Music paused.';}
 if(action.type==='resume'){if(player.current()){if(!player.isPlaying())player.toggle();response='Back to the music.';}else return start();}
 if(action.type==='next'){player.next();response='On to the next one.';}
 if(action.type==='prev'){player.prev();response='Taking it back.';}
 if(action.type==='shuffle'){if(player.state.shuffle!==action.enabled)player.toggleShuffle();response=`Shuffle ${action.enabled?'on':'off'}.`;}
 if(action.type==='like'){const t=player.current();if(t&&!store.isLiked(t.id))store.toggleLike(t);response=t?'Saved to your Liked Songs.':'Play a song first.';}
 if(action.type==='identify'){const t=player.current();response=t?`This is ${t.title}, by ${t.artist}.`:'Nothing is playing yet.';}
 if(action.type==='change')return start('',{change:true});
 state.message=response;emit();await voice.speak(response);
}
export async function start(prompt='',{change=false}={}){
 localModel.cancel();
 const action=parseCommand(prompt);
 if(action){++requestToken;state.busy=false;return command(action);}
 if(isConversation(prompt))return talk(prompt);
 const my=++requestToken;voice.cancelSpeech();state.busy=true;state.request=prompt;state.message='Finding your next mix…';emit();
 try{
  let tracks=[],reason='',query=fallbackQuery(prompt),radioSeed=null;state.engine='Quick mix';
  if(/^(more( like this| of this)?|similar( songs)?|same vibe)$/i.test(query)&&player.current())query=player.current().artist;
  const moods=[[/\b(study|studying|focus|concentrat)/i,'chill instrumental'],[/\b(workout|gym|running)\b/i,'workout'],[/\b(sleep|sleeping|relaxing)\b/i,'ambient'],[/\b(less energy|calmer|chill out)\b/i,'chill'],[/\b(more energy|hype me|upbeat)\b/i,'dance pop']];
  if(/^(study|studying|focus|workout|gym|sleep|sleeping|relaxing|less energy|calmer|chill out|more energy|hype me|upbeat)$|^(something|music|songs|mix|tracks|playlist)\b/i.test(query))for(const [pattern,phrase]of moods)if(pattern.test(query)){query=phrase;break;}
  if(query){
   const local=uniqueTracks([...store.getLikes(),...store.getRecent()]).filter(t=>`${t.artist} ${t.title}`.toLowerCase().includes(query.toLowerCase()));
   tracks=local.length?local:await api.searchTracks(query);
   if(!tracks.length&&localModel.status.phase==='ready'){
    const phrase=await Promise.race([localModel.interpret(prompt),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]);
    if(phrase&&phrase.length<120&&!/[{}<>]/.test(phrase)){tracks=await api.searchTracks(phrase);state.engine='On-device AI';}
   }
   reason=`Your mix: ${query}.`;
  }else{
   const library=uniqueTracks([...store.getLikes(),...store.getRecent()]);if(change)state.seed++;
   const seeds=library.filter(t=>t.artistId),seed=seeds[state.seed%seeds.length];
   if(library.length){tracks=seed?uniqueTracks([seed,...library]):library;radioSeed=seed;reason=seed?`Starting with ${seed.artist}. More discoveries are on the way.`:'A mix of your favorites, ready to go.';}
   else{tracks=await api.searchTracks('popular hits');reason='A fresh mix to get you started. Like your favorites to make it yours.';}
  }
  if(my!==requestToken)return;
  tracks=visibleTracks(uniqueTracks(tracks),store.getSettings()).slice(0,40);
  if(!tracks.length)throw new Error('No match yet. Try an artist, song, or a broader mood.');
  if(change&&tracks.length>1){const offset=(Math.max(0,tracks.findIndex(t=>t.id===player.current()?.id))+1)%tracks.length;tracks=[...tracks.slice(offset),...tracks.slice(0,offset)];}
  state.active=true;state.tracks=tracks;state.message=reason;state.busy=false;announced=tracks[0].id;trackCount=0;
  player.playList(tracks,0,{shuffle:false});emit();
  if(radioSeed)api.artistRadio(radioSeed.artistId).then(more=>{
   if(my!==requestToken||!state.active)return;
   const added=visibleTracks(uniqueTracks(more),store.getSettings()).filter(t=>!state.tracks.some(x=>x.id===t.id)).slice(0,25);
   if(added.length){state.tracks=[...state.tracks,...added];player.addToQueue(added);emit();}
  }).catch(()=>{});
  await voice.speak(`${reason} First up, ${tracks[0].title}, by ${tracks[0].artist}.`);
 }catch(error){if(my===requestToken){state.message=error.message;emit();}}
 finally{if(my===requestToken){state.busy=false;emit();}}
}
export async function talk(prompt){
 const my=++requestToken;voice.cancelSpeech();state.request=prompt;state.busy=true;state.message='Thinking…';emit();
 if(!liveReady()){state.busy=false;state.message='Tap Enable live DJ to start a conversation. Music requests work right away.';emit();return;}
 const reply=voice.beginReply();
 try{
  const current=player.current(),context={track:current?{title:current.title,artist:current.artist}:null,artists:[...new Set(store.getLikes().map(t=>t.artist))].slice(0,4)};
  const answer=await localModel.chat(prompt,context,conversation,{onText:text=>{if(my===requestToken)reply.caption(text);},onSentence:text=>{if(my===requestToken)reply.push(text);}});
  if(my!==requestToken)return;
  reply.caption(answer);conversation.push({role:'user',content:prompt},{role:'assistant',content:answer});conversation.splice(0,Math.max(0,conversation.length-4));state.message='Tap the mic to interrupt or ask a follow-up.';
 }catch(error){if(my===requestToken&&error.name!=='AbortError')state.message=error.message;}
 finally{reply.end();await reply.done;if(my===requestToken){state.busy=false;emit();}}
}
export function stop(){++requestToken;localModel.cancel();state.active=false;state.busy=false;voice.stop();emit();}
voice.bindRequest(start);
voice.bindInterrupt(()=>{++requestToken;localModel.cancel();state.busy=false;emit();});
player.on('state',()=>{const t=player.current();if(!state.active||!player.isPlaying()||player.state.loading||!t||t.id===announced||!state.tracks.some(x=>x.id===t.id))return;announced=t.id;trackCount++;if(trackCount%4===0&&store.getSettings().djCommentary!==false)void voice.speak(`Up next: ${t.title}, by ${t.artist}.`);});

document.addEventListener?.('visibilitychange',()=>{if(document.hidden){++requestToken;localModel.cancel();state.busy=false;emit();}});
