export function storageMock(){const values=new Map();return {getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear()};}
export class FakeAudio extends EventTarget {
  constructor(){super();this.src='';this.crossOrigin=null;this.currentTime=0;this.duration=180;this.volume=1;this.paused=true;this.preload='';this._attrs=new Map();}
  canPlayType(){return 'probably';}
  async play(){this.paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));}
  pause(){const changed=!this.paused;this.paused=true;if(changed)this.dispatchEvent(new Event('pause'));}
  load(){}
  setAttribute(name,value){this._attrs.set(name,String(value));if(name==='crossorigin')this.crossOrigin=value;}
  getAttribute(name){return this._attrs.has(name)?this._attrs.get(name):null;}
  removeAttribute(name){this._attrs.delete(name);if(name==='src')this.src='';if(name==='crossorigin')this.crossOrigin=null;}
}
export function browserMocks(){
  globalThis.localStorage=storageMock();globalThis.Audio=FakeAudio;
  globalThis.window={addEventListener(){},caches:{}};
  globalThis.document={createElement:()=>new FakeAudio()};
  globalThis.location={href:'http://127.0.0.1:8080/'};
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
  const saved=new Map();
  globalThis.caches={open:async()=>({match:async key=>saved.has(key)?new Response(saved.get(key)):new Response(new Blob(['unit test audio'],{type:'audio/wav'})),put:async(key,res)=>saved.set(key,await res.blob()),delete:async key=>saved.delete(key)}),keys:async()=>[]};
  return saved;
}
export async function settle(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
