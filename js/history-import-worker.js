import {unzipSync,strFromU8} from './vendor/fflate.js';
import {parseHistory} from './listening-history.js';
self.onmessage=event=>{
  try{
    const {bytes,name}=event.data;let records=[];
    if(/\.zip$/i.test(name)){
      let size=0;
      const files=unzipSync(new Uint8Array(bytes),{filter:file=>{
        const include=/\/(?:StreamingHistory(?:_music)?_?\d*|Streaming_History_Audio[^/]*|streaming_history[^/]*)\.json$/i.test('/'+file.name);
        if(include){size+=file.originalSize;if(size>128*1024*1024)throw new Error('This archive is too large for a phone. Import the individual streaming-history JSON files instead.');}return include;
      }});
      for(const bytes of Object.values(files))records=records.concat(parseHistory(JSON.parse(strFromU8(bytes))));
    }else records=parseHistory(JSON.parse(new TextDecoder().decode(bytes)));
    if(!records.length)throw new Error('No music listening history found. Choose the Streaming History files from your Spotify data download.');
    self.postMessage({records});
  }catch(error){self.postMessage({error:error.message});}
};
