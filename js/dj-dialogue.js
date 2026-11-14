// Bounded context and sentence chunks keep local conversation quick and cancellable.
export function isConversation(text){const q=String(text).trim();if(/^(?:(?:hey|hi)[,!]?\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:play|put on|find|give me|skip|pause|resume|stop|save|like)\b/i.test(q))return false;return /^(hi|hey|hello|thanks|thank you|good (morning|evening)|how (are|do|did|can|should)|what (do|are|can|kind)|why|who (are|is)|tell me|can (you|we)|do you|are you|i feel|i'm feeling|im feeling|i am feeling|i had|i've had|i have had)\b/i.test(q);}
export function speechChunks(text,max=110){
 const words=String(text).replace(/[*_`#]/g,'').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,480).split(' '),chunks=[];let line='';
 for(const word of words){const limit=chunks.length?max:70;if(line&&(line.length+word.length>limit||(/[.!?]$/.test(line)&&line.length>24))){chunks.push(line);line='';}line+=(line?' ':'')+word;}
 if(line)chunks.push(line);return chunks;
}
export function safeConversationSentence(text,context={}){
 const value=String(text).trim();
 // Music discovery is a catalog operation. The tiny model must not invent named songs.
 const quotes=[...value.matchAll(/["“]([^"”]+)["”]/g)].map(x=>x[1].trim().toLowerCase());
 if(quotes.some(title=>title!==String(context.track?.title||'').trim().toLowerCase()))return '';
 if(/\bi(?:'ve| have)?\s+(?:queued|added|started|played|paused|saved|skipped|changed)\b/i.test(value))return '';
 return value;
}
export function conversationMessages(prompt,context={},history=[]){
 const facts=context.track?`Playing: ${String(context.track.title).slice(0,90)} by ${String(context.track.artist).slice(0,90)}.`:'No song is playing.';
 const likes=Array.isArray(context.artists)?context.artists.slice(0,4).map(x=>String(x).slice(0,50)).join(', '):'';
 return [{role:'system',content:`You are a friendly music DJ. Suggest a music STYLE that fits the request, then ask one music question. Talk about genres and moods, not song titles or artists. Answer only in English. Use at most 30 words, without a list. Never make up details about the listener. Never claim to control playback. ${facts} Favorite artists: ${likes||'not known'}. Ask one simple music or mood question when helpful.`},...history.slice(-4).filter(x=>['user','assistant'].includes(x.role)).map(x=>({role:x.role,content:String(x.content).slice(0,240)})),{role:'user',content:String(prompt).slice(0,300)}];
}
