/* Runs before first paint (classic, blocking): maintenance gate, theme colors, and landing flag. */
(function(){
var MAINTENANCE=false;
var OWNER_HASH='79c4cfae747eb72c8024860365cad93fb4cc243b91ab0b4c787ed1d2687c8a38';
var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function sha(str){
  var u=unescape(encodeURIComponent(String(str||''))),l=u.length,bl=l*8,pl=Math.ceil((l+9)/64)*64,b=new Uint8Array(pl),i;
  for(i=0;i<l;i++)b[i]=u.charCodeAt(i);b[l]=0x80;
  var dv=new DataView(b.buffer);dv.setUint32(pl-8,Math.floor(bl/0x100000000),false);dv.setUint32(pl-4,bl>>>0,false);
  var h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19,w=new Uint32Array(64),o;
  for(o=0;o<pl;o+=64){
    for(i=0;i<16;i++)w[i]=dv.getUint32(o+i*4,false);
    for(i=16;i<64;i++){var x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(((x>>>7)|(x<<25))^((x>>>18)|(x<<14))^(x>>>3))+w[i-7]+(((y>>>17)|(y<<15))^((y>>>19)|(y<<13))^(y>>>10)))>>>0;}
    var a=h0,bb=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for(i=0;i<64;i++){
      var s1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)),ch=(e&f)^(~e&g),t1=(h+s1+ch+K[i]+w[i])>>>0;
      var s0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)),mj=(a&bb)^(a&c)^(bb&c),t2=(s0+mj)>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=bb;bb=a;a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0;h1=(h1+bb)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
  }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(function(v){return v.toString(16).padStart(8,'0');}).join('');
}
function validTok(raw,orig,now){
  try{var d=JSON.parse(raw||'');if(!d||d.v!==2||d.h!==OWNER_HASH||!d.n||!(d.exp>now))return false;return d.s===sha('spotplus-session-v2:'+orig+':'+d.h+':'+d.n+':'+d.exp);}catch(e){return false;}
}
var allow=false;
if(MAINTENANCE){
  try{
    var orig=(location.origin&&location.origin!=='null')?location.origin:'https://spotplus.local';
    var now=Date.now();
    var q=new URLSearchParams(location.search);
    var p=(q.get('dev')||q.get('owner')||q.get('access')||'').trim();
    if(!p){var hm=(location.hash||'').match(/(?:dev|owner|access)=([^&/]+)/i);if(hm)p=decodeURIComponent(hm[1]);}
    var m=p.match(/user\/([A-Za-z0-9._-]{1,64})/i);
    var norm=(m?m[1]:p.replace(/^spotify:user:/i,'').replace(/^@+/,'')).toLowerCase();
    var att=JSON.parse(localStorage.getItem('spotplus.devAttempts')||'null');
    if(norm&&!(att&&att.until>now)&&sha('spotplus-gate-v2:'+norm)===OWNER_HASH){
      var n=Math.random().toString(36).slice(2)+now.toString(36),exp=now+2592000000;
      localStorage.setItem('spotplus.devAccess',JSON.stringify({v:2,h:OWNER_HASH,n:n,exp:exp,s:sha('spotplus-session-v2:'+orig+':'+OWNER_HASH+':'+n+':'+exp)}));
      localStorage.removeItem('spotplus.devAttempts');
      allow=true;
    }
    if(p&&history.replaceState){
      var cleanUrl=new URL(location.href);
      ['dev','owner','access'].forEach(function(k){cleanUrl.searchParams.delete(k);});
      if(/^#(?:dev|owner|access)=/i.test(cleanUrl.hash))cleanUrl.hash='';
      history.replaceState(null,'',cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
    }
    if(!allow){
      allow=validTok(localStorage.getItem('spotplus.devAccess'),orig,now)||validTok(localStorage.getItem('spotplus.devAccount'),orig,now);
    }
  }catch(e){}
  if(!allow)document.documentElement.dataset.maintenance='checking';
}else if(history.replaceState){
  try{
    var openUrl=new URL(location.href),dirty=false;
    ['dev','owner','access'].forEach(function(k){if(openUrl.searchParams.has(k)){openUrl.searchParams.delete(k);dirty=true;}});
    if(/^#(?:dev|owner|access)=/i.test(openUrl.hash)){openUrl.hash='';dirty=true;}
    if(dirty)history.replaceState(null,'',openUrl.pathname+openUrl.search+openUrl.hash);
  }catch(e){}
}
// Before first paint: match the status bar and page color to the saved theme, so
// light themes never flash black and the iPhone status bar text stays readable.
try{var sa=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;if((!MAINTENANCE||allow)&&!sa&&!localStorage.getItem('spotplus.landing')&&!localStorage.getItem('spotplus.onboarded.v2')&&!/^#\/(jam\/|spotify-account|linked\/|spotify\/)/.test(location.hash))document.documentElement.classList.add('landing');}catch(e){}
try{var c=JSON.parse(localStorage.getItem('spotplus.chrome')||'null');if(c&&/^#[0-9a-f]{6}$/i.test(c.canvas)){document.querySelector('meta[name=theme-color]').content=c.canvas;document.documentElement.style.background=c.canvas;document.documentElement.dataset.mode=c.mode==='light'?'light':'dark';if(c.chrome==='clear')document.documentElement.dataset.chrome='clear';}
document.write('<meta name="apple-mobile-web-app-status-bar-style" content="'+(c&&c.mode==='light'?'default':'black-translucent')+'">');}catch(e){document.write('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');}
})();
