// Public Spotify embeds and user-selected exports. No passwords, cookies or tokens.
export const collections=[
  {
    "id": "37i9dQZF1DXcBWIGoYBM5M",
    "title": "Today’s Top Hits",
    "category": "Editorial",
    "cover": "https://i.scdn.co/image/ab67706f00000002f04528c743e20039ac4eff07"
  },
  {
    "id": "37i9dQZF1DX0XUsuxWHRQd",
    "title": "RapCaviar",
    "category": "Editorial",
    "cover": "https://i.scdn.co/image/ab67706f00000002ba757d984cae0ad4cfcbf1a8"
  },
  {
    "id": "37i9dQZF1DX10zKzsJ2jva",
    "title": "Viva Latino",
    "category": "Editorial",
    "cover": "https://i.scdn.co/image/ab67706f0000000214fdfb5cfd606164a8fa6121"
  },
  {
    "id": "37i9dQZF1DZ06evO3n0Aus",
    "title": "This Is Tame Impala",
    "artist": "Tame Impala",
    "category": "This Is",
    "cover": "https://pickasso.spotifycdn.com/image/ab67c0de0000deef/dt/v1/img/thisisv3/5INjqkS1o8h1imAzPqGZBb/en"
  },
  {
    "id": "37i9dQZF1DX7QOv5kjbU68",
    "title": "This Is Drake",
    "artist": "Drake",
    "category": "This Is",
    "cover": "https://i.scdn.co/image/ab67706f00000002e47c587e5107b565327a2172"
  },
  {
    "id": "37i9dQZF1DX5KpP2LN299J",
    "title": "This Is Taylor Swift",
    "artist": "Taylor Swift",
    "category": "This Is",
    "cover": "https://i.scdn.co/image/ab67706f00000002fb24bccb89a4fbbd3fdf201b"
  },
  {
    "id": "37i9dQZF1DXbzvkbLgvQvI",
    "title": "Viva Latino No. 1s",
    "category": "Editorial",
    "cover": "https://i.scdn.co/image/ab67706f0000000223748c4e1779c5aefef3cc7e"
  },
  {
    "id": "37i9dQZF1DWZFV9Asvj1J9",
    "title": "RapCaviar Presents: Best Hip-Hop Songs of 2025",
    "category": "Editorial",
    "cover": "https://i.scdn.co/image/ab67706f00000002b414d16d320ee77cb187a773"
  }
];
export function parseSpotifyLink(input){
  const value=String(input).trim();const uri=value.match(/^spotify:(playlist|artist|album|track):([a-zA-Z0-9]{22})$/);if(uri)return {type:uri[1],id:uri[2]};
  try{const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='open.spotify.com')return null;const m=url.pathname.match(/^\/(?:intl-[a-z]+\/)?(?:embed\/)?(playlist|artist|album|track)\/([a-zA-Z0-9]{22})\/?$/);return m?{type:m[1],id:m[2]}:null;}catch{return null;}
}
export const urlFor=({type='playlist',id})=>`https://open.spotify.com/${type}/${id}`;
const memo=new Map();
export async function metadata(item){
  const key=urlFor(item);if(memo.has(key))return memo.get(key);
  const promise=fetch('https://open.spotify.com/oembed?url='+encodeURIComponent(key),{signal:AbortSignal.timeout(8000)}).then(async r=>{if(!r.ok)throw new Error('This Spotify link is unavailable or private.');const d=await r.json();return {...item,title:d.title||item.title||'Spotify',cover:d.thumbnail_url||'',externalUrl:key};});
  memo.set(key,promise);promise.catch(()=>memo.delete(key));return promise;
}
export function importFile(file){return new Promise(async(resolve,reject)=>{const worker=new Worker(new URL('./spotify-import-worker.js',import.meta.url),{type:'module'});const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Import took too long. Try an individual playlist JSON file.'));},30000);worker.onmessage=({data})=>{clearTimeout(timeout);worker.terminate();data.error?reject(new Error(data.error)):resolve(data.result);};worker.onerror=()=>{clearTimeout(timeout);worker.terminate();reject(new Error('Could not read this export. Choose a Spotify Account data ZIP or JSON file.'));};try{const buffer=await file.arrayBuffer();worker.postMessage({buffer,name:file.name},[buffer]);}catch(error){clearTimeout(timeout);worker.terminate();reject(error);}});}
