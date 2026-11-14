import {readSpotifyArchive} from './spotify-import.js';
self.onmessage=({data})=>{try{self.postMessage({result:readSpotifyArchive(data.buffer,data.name)});}catch(e){self.postMessage({error:e.message});}};
