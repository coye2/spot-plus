/* Runs before first paint (classic, blocking): maintenance gate, theme colors, and landing flag. */
(function(){
var MAINTENANCE=true;
var allow=false;
if(MAINTENANCE){
  try{
    var q=new URLSearchParams(location.search);
    var p=(q.get('dev')||q.get('owner')||q.get('access')||'').trim();
    if(!p){var hm=(location.hash||'').match(/(?:dev|owner|access)=([^&/]+)/i);if(hm)p=decodeURIComponent(hm[1]);}
    var m=p.match(/user\/([A-Za-z0-9._-]{1,64})/i);
    var norm=(m?m[1]:p.replace(/^spotify:user:/i,'').replace(/^@+/,'')).toLowerCase();
    if(norm==='coye-9'){localStorage.setItem('spotplus.devAccess','coye-9');allow=true;}
    if(!allow){
      var da=(localStorage.getItem('spotplus.devAccess')||'').toLowerCase();
      var dc=(localStorage.getItem('spotplus.devAccount')||'').toLowerCase();
      allow=da==='coye-9'||dc==='coye-9';
    }
  }catch(e){}
  if(!allow)document.documentElement.dataset.maintenance='checking';
}
// Before first paint: match the status bar and page color to the saved theme, so
// light themes never flash black and the iPhone status bar text stays readable.
try{var sa=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;if((!MAINTENANCE||allow)&&!sa&&!localStorage.getItem('spotplus.landing')&&!localStorage.getItem('spotplus.onboarded.v2')&&!/^#\/(jam\/|spotify-account|linked\/|spotify\/)/.test(location.hash))document.documentElement.classList.add('landing');}catch(e){}
try{var c=JSON.parse(localStorage.getItem('spotplus.chrome')||'null');if(c&&/^#[0-9a-f]{6}$/i.test(c.canvas)){document.querySelector('meta[name=theme-color]').content=c.canvas;document.documentElement.style.background=c.canvas;document.documentElement.dataset.mode=c.mode==='light'?'light':'dark';if(c.chrome==='clear')document.documentElement.dataset.chrome='clear';}
document.write('<meta name="apple-mobile-web-app-status-bar-style" content="'+(c&&c.mode==='light'?'default':'black-translucent')+'">');}catch(e){document.write('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');}
})();
