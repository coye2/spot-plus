const normalized=text=>String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
// Rank only alternatives actually returned by recognition; never invent a song name.
export function chooseAlternative(result,tracks=[]){
 const options=Array.from(result||[]).filter(item=>item?.transcript?.trim());if(!options.length)return '';
 const known=[...new Set(tracks.slice(0,100).flatMap(t=>[t.artist,t.title]).filter(Boolean).map(normalized))].filter(x=>x.length>=4);
 const score=(item,index)=>{const text=' '+normalized(item.transcript)+' ';const confidence=Number(item.confidence)||(.8-index*.035);return confidence+Math.min(.12,known.filter(name=>text.includes(' '+name+' ')).length*.08);};
 let best=options[0],value=score(best,0);for(let i=1;i<Math.min(options.length,5);i++){const next=score(options[i],i);if(next>value+.025){best=options[i];value=next;}}
 return best.transcript.trim();
}
export function transcriptParts(results,tracks){
 let final='',interim='';for(const result of Array.from(results||[])){const text=chooseAlternative(result,tracks);if(result.isFinal)final+=(final?' ':'')+text;else interim+=(interim?' ':'')+text;}
 return {final,interim,text:[final,interim].filter(Boolean).join(' ')};
}
