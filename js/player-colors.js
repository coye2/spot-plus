import {mix,contrast} from './themes.js';

export function songPalette(pixels) {
  const buckets=new Map();
  for(let i=0;i<pixels.length;i+=4){
    if(pixels[i+3]<128)continue;
    const rgb=[pixels[i],pixels[i+1],pixels[i+2]],hi=Math.max(...rgb),lo=Math.min(...rgb);
    if(hi<25||lo>235)continue;
    const key=rgb.map(v=>Math.round(v/32)*32).join(',');
    const item=buckets.get(key)||{weight:0,sum:[0,0,0],n:0};
    item.weight+=1+(hi-lo)/90;item.n++;rgb.forEach((v,j)=>item.sum[j]+=v);buckets.set(key,item);
  }
  const best=[...buckets.values()].sort((a,b)=>b.weight-a.weight)[0];
  let color=best?'#'+best.sum.map(v=>Math.round(v/best.n).toString(16).padStart(2,'0')).join(''):'#1b5e46';
  while(contrast(color,'#ffffff')<5.2)color=mix(color,'#000000',.12);
  return {color,surface:mix(color,'#000000',.42),deep:mix(color,'#000000',.78)};
}

export class PlayerColors {
  constructor(onColor){this.onColor=onColor;this.cache=new Map();this.key='';this.generation=0;this.lastFrame=0;}
  read(source){const canvas=document.createElement('canvas');canvas.width=canvas.height=24;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,24,24);return songPalette(ctx.getImageData(0,0,24,24).data);}
  setTrack(track){
    const key=track?.cover||track?.coverXl||'';if(this.trackId===track?.id)return;this.trackId=track?.id;
    this.key=key;const generation=++this.generation;this.blockedVideo='';
    this.onColor(this.cache.get(key)||songPalette([]));
    if(!key||this.cache.has(key))return;
    const image=new Image();image.crossOrigin='anonymous';image.decoding='async';
    image.onload=()=>{if(generation!==this.generation)return;try{const p=this.read(image);this.cache.set(key,p);if(this.cache.size>80)this.cache.delete(this.cache.keys().next().value);this.onColor(p);}catch{/* Keep the accessible fallback when the image disallows pixel access. */}};
    image.onerror=()=>{image.onerror=null;if(generation===this.generation){const retry=new URL(key,location.href);retry.searchParams.set('spotplus-color','1');image.src=retry.href;}};
    image.src=key;
  }
  sampleVideo(video){
    if(!video||video.paused||video.readyState<2||video.currentSrc===this.blockedVideo||Date.now()-this.lastFrame<4000)return;
    this.lastFrame=Date.now();try{this.onColor(this.read(video));}catch{this.blockedVideo=video.currentSrc;}
  }
}

export function syncChrome(color){
  document.documentElement.style.setProperty('--chrome-color',color);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',color);
}
