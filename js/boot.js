/* Runs before first paint (classic, blocking): theme colors and the download-page flag. */
(function(){
// Before first paint: match the status bar and page color to the saved theme, so
// light themes never flash black and the iPhone status bar text stays readable.
try{var sa=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;if(!sa&&!localStorage.getItem('spotplus.landing')&&!localStorage.getItem('spotplus.onboarded.v2')&&!/^#\/(jam\/|spotify-account|linked\/|spotify\/)/.test(location.hash))document.documentElement.classList.add('landing');}catch(e){}
try{var c=JSON.parse(localStorage.getItem('spotplus.chrome')||'null');if(c&&/^#[0-9a-f]{6}$/i.test(c.canvas)){document.querySelector('meta[name=theme-color]').content=c.canvas;document.documentElement.style.background=c.canvas;document.documentElement.dataset.mode=c.mode==='light'?'light':'dark';if(c.chrome==='clear')document.documentElement.dataset.chrome='clear';}
document.write('<meta name="apple-mobile-web-app-status-bar-style" content="'+(c&&c.mode==='light'?'default':'black-translucent')+'">');}catch(e){document.write('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">');}
})();
