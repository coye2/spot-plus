import test from 'node:test';import assert from 'node:assert/strict';
import {isConversation,speechChunks,conversationMessages,safeConversationSentence} from '../js/dj-dialogue.js';
test('conversation is routed separately from music titles and direct playback requests',()=>{
 for(const input of ['Hey, how are you?','I had a rough day','Tell me about jazz','Why did you pick this?'])assert.equal(isConversation(input),true);
 for(const input of ['Next to Me','Play some jazz','Taylor Swift','more energy','pause','Could you play some jazz?','Hey, can you skip this song?'])assert.equal(isConversation(input),false);
});
test('conversation drops invented quoted song names and unsupported playback claims',()=>{
 assert.equal(safeConversationSentence('Try "Imaginary Song" by an artist.'), '');assert.equal(safeConversationSentence("I've queued something for you."),'');assert.equal(safeConversationSentence('Try gentle jazz.'),'Try gentle jazz.');assert.equal(safeConversationSentence('You chose "Real Song".',{track:{title:'Real Song'}}),'You chose "Real Song".');
});
test('speech chunks preserve new reply text and bound first-audio work',()=>{
 const reply='Tonight we are listening to an artist you just discovered. What do you like about this song?';const chunks=speechChunks(reply);assert.equal(chunks.join(' '),reply);assert.ok(chunks[0].length<=70);assert.ok(chunks.every(x=>x.length<=110));
});
test('conversation uses actual track context and only a bounded recent history',()=>{
 const messages=conversationMessages('How about something calmer?',{track:{title:'Test Song',artist:'Real Artist'},artists:['Favorite']},Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'x'.repeat(1000)})));
 assert.equal(messages.length,6);assert.match(messages[0].content,/Test Song by Real Artist/);assert.ok(messages.slice(1,-1).every(x=>x.content.length<=240));assert.equal(messages.at(-1).content,'How about something calmer?');
});
