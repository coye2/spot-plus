/*spotplus-helper-core*/(()=>{if(document.documentElement.dataset.spotplusCompanion)return;document.documentElement.dataset.spotplusCompanion='1';
var SpotPlusSync=(()=>{var Ve=Object.defineProperty;var rr=Object.getOwnPropertyDescriptor;var nr=Object.getOwnPropertyNames;var ir=Object.prototype.hasOwnProperty;var or=(e,r)=>{for(var n in r)Ve(e,n,{get:r[n],enumerable:!0})},sr=(e,r,n,t)=>{if(r&&typeof r=="object"||typeof r=="function")for(let i of nr(r))!ir.call(e,i)&&i!==n&&Ve(e,i,{get:()=>r[i],enumerable:!(t=rr(r,i))||t.enumerable});return e};var ar=e=>sr(Ve({},"__esModule",{value:!0}),e);var _r={};or(_r,{SYNC_RELAYS:()=>nt,fetchSnapshot:()=>Qr,newSyncKey:()=>Xr,openSnapshot:()=>er,publishSnapshot:()=>Jr,sealSnapshot:()=>_t,syncIdentity:()=>it,validSyncKey:()=>Jt});var fe=typeof globalThis=="object"&&"crypto"in globalThis?globalThis.crypto:void 0;function ke(e){return e instanceof Uint8Array||ArrayBuffer.isView(e)&&e.constructor.name==="Uint8Array"}function Ye(e){if(!Number.isSafeInteger(e)||e<0)throw new Error("positive integer expected, got "+e)}function se(e,...r){if(!ke(e))throw new Error("Uint8Array expected");if(r.length>0&&!r.includes(e.length))throw new Error("Uint8Array expected of length "+r+", got length="+e.length)}function mt(e){if(typeof e!="function"||typeof e.create!="function")throw new Error("Hash should be wrapped by utils.createHasher");Ye(e.outputLen),Ye(e.blockLen)}function Ae(e,r=!0){if(e.destroyed)throw new Error("Hash instance has been destroyed");if(r&&e.finished)throw new Error("Hash#digest() has already been called")}function lr(e,r){se(e);let n=r.outputLen;if(e.length<n)throw new Error("digestInto() expects output buffer of length at least "+n)}function Ie(...e){for(let r=0;r<e.length;r++)e[r].fill(0)}function Ke(e){return new DataView(e.buffer,e.byteOffset,e.byteLength)}function Y(e,r){return e<<32-r|e>>>r}var bt=typeof Uint8Array.from([]).toHex=="function"&&typeof Uint8Array.fromHex=="function",fr=Array.from({length:256},(e,r)=>r.toString(16).padStart(2,"0"));function Z(e){if(se(e),bt)return e.toHex();let r="";for(let n=0;n<e.length;n++)r+=fr[e[n]];return r}var G={_0:48,_9:57,A:65,F:70,a:97,f:102};function at(e){if(e>=G._0&&e<=G._9)return e-G._0;if(e>=G.A&&e<=G.F)return e-(G.A-10);if(e>=G.a&&e<=G.f)return e-(G.a-10)}function ce(e){if(typeof e!="string")throw new Error("hex string expected, got "+typeof e);if(bt)return Uint8Array.fromHex(e);let r=e.length,n=r/2;if(r%2)throw new Error("hex string expected, got unpadded hex of length "+r);let t=new Uint8Array(n);for(let i=0,o=0;i<n;i++,o+=2){let s=at(e.charCodeAt(o)),l=at(e.charCodeAt(o+1));if(s===void 0||l===void 0){let f=e[o]+e[o+1];throw new Error('hex string expected, got non-hex character "'+f+'" at index '+o)}t[i]=s*16+l}return t}function Et(e){if(typeof e!="string")throw new Error("string expected");return new Uint8Array(new TextEncoder().encode(e))}function Je(e){return typeof e=="string"&&(e=Et(e)),se(e),e}function $(...e){let r=0;for(let t=0;t<e.length;t++){let i=e[t];se(i),r+=i.length}let n=new Uint8Array(r);for(let t=0,i=0;t<e.length;t++){let o=e[t];n.set(o,i),i+=o.length}return n}var vt=class{};function ur(e){let r=t=>e().update(Je(t)).digest(),n=e();return r.outputLen=n.outputLen,r.blockLen=n.blockLen,r.create=()=>e(),r}function qe(e=32){if(fe&&typeof fe.getRandomValues=="function")return fe.getRandomValues(new Uint8Array(e));if(fe&&typeof fe.randomBytes=="function")return Uint8Array.from(fe.randomBytes(e));throw new Error("crypto.getRandomValues must be defined")}function cr(e,r,n,t){if(typeof e.setBigUint64=="function")return e.setBigUint64(r,n,t);let i=BigInt(32),o=BigInt(4294967295),s=Number(n>>i&o),l=Number(n&o),f=t?4:0,u=t?0:4;e.setUint32(r+f,s,t),e.setUint32(r+u,l,t)}function dr(e,r,n){return e&r^~e&n}function hr(e,r,n){return e&r^e&n^r&n}var pr=class extends vt{constructor(e,r,n,t){super(),this.finished=!1,this.length=0,this.pos=0,this.destroyed=!1,this.blockLen=e,this.outputLen=r,this.padOffset=n,this.isLE=t,this.buffer=new Uint8Array(e),this.view=Ke(this.buffer)}update(e){Ae(this),e=Je(e),se(e);let{view:r,buffer:n,blockLen:t}=this,i=e.length;for(let o=0;o<i;){let s=Math.min(t-this.pos,i-o);if(s===t){let l=Ke(e);for(;t<=i-o;o+=t)this.process(l,o);continue}n.set(e.subarray(o,o+s),this.pos),this.pos+=s,o+=s,this.pos===t&&(this.process(r,0),this.pos=0)}return this.length+=e.length,this.roundClean(),this}digestInto(e){Ae(this),lr(e,this),this.finished=!0;let{buffer:r,view:n,blockLen:t,isLE:i}=this,{pos:o}=this;r[o++]=128,Ie(this.buffer.subarray(o)),this.padOffset>t-o&&(this.process(n,0),o=0);for(let h=o;h<t;h++)r[h]=0;cr(n,t-8,BigInt(this.length*8),i),this.process(n,0);let s=Ke(e),l=this.outputLen;if(l%4)throw new Error("_sha2: outputLen should be aligned to 32bit");let f=l/4,u=this.get();if(f>u.length)throw new Error("_sha2: outputLen bigger than state");for(let h=0;h<f;h++)s.setUint32(4*h,u[h],i)}digest(){let{buffer:e,outputLen:r}=this;this.digestInto(e);let n=e.slice(0,r);return this.destroy(),n}_cloneInto(e){e||(e=new this.constructor),e.set(...this.get());let{blockLen:r,buffer:n,length:t,finished:i,destroyed:o,pos:s}=this;return e.destroyed=o,e.finished=i,e.length=t,e.pos=s,t%r&&e.buffer.set(n),e}clone(){return this._cloneInto()}},Q=Uint32Array.from([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]),yr=Uint32Array.from([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),_=new Uint32Array(64),wr=class extends pr{constructor(e=32){super(64,e,8,!1),this.A=Q[0]|0,this.B=Q[1]|0,this.C=Q[2]|0,this.D=Q[3]|0,this.E=Q[4]|0,this.F=Q[5]|0,this.G=Q[6]|0,this.H=Q[7]|0}get(){let{A:e,B:r,C:n,D:t,E:i,F:o,G:s,H:l}=this;return[e,r,n,t,i,o,s,l]}set(e,r,n,t,i,o,s,l){this.A=e|0,this.B=r|0,this.C=n|0,this.D=t|0,this.E=i|0,this.F=o|0,this.G=s|0,this.H=l|0}process(e,r){for(let h=0;h<16;h++,r+=4)_[h]=e.getUint32(r,!1);for(let h=16;h<64;h++){let g=_[h-15],a=_[h-2],y=Y(g,7)^Y(g,18)^g>>>3,v=Y(a,17)^Y(a,19)^a>>>10;_[h]=v+_[h-7]+y+_[h-16]|0}let{A:n,B:t,C:i,D:o,E:s,F:l,G:f,H:u}=this;for(let h=0;h<64;h++){let g=Y(s,6)^Y(s,11)^Y(s,25),a=u+g+dr(s,l,f)+yr[h]+_[h]|0,y=(Y(n,2)^Y(n,13)^Y(n,22))+hr(n,t,i)|0;u=f,f=l,l=s,s=o+a|0,o=i,i=t,t=n,n=a+y|0}n=n+this.A|0,t=t+this.B|0,i=i+this.C|0,o=o+this.D|0,s=s+this.E|0,l=l+this.F|0,f=f+this.G|0,u=u+this.H|0,this.set(n,t,i,o,s,l,f,u)}roundClean(){Ie(_)}destroy(){this.set(0,0,0,0,0,0,0,0),Ie(this.buffer)}},W=ur(()=>new wr),Bt=class extends vt{constructor(e,r){super(),this.finished=!1,this.destroyed=!1,mt(e);let n=Je(r);if(this.iHash=e.create(),typeof this.iHash.update!="function")throw new Error("Expected instance of class which extends utils.Hash");this.blockLen=this.iHash.blockLen,this.outputLen=this.iHash.outputLen;let t=this.blockLen,i=new Uint8Array(t);i.set(n.length>t?e.create().update(n).digest():n);for(let o=0;o<i.length;o++)i[o]^=54;this.iHash.update(i),this.oHash=e.create();for(let o=0;o<i.length;o++)i[o]^=106;this.oHash.update(i),Ie(i)}update(e){return Ae(this),this.iHash.update(e),this}digestInto(e){Ae(this),se(e,this.outputLen),this.finished=!0,this.iHash.digestInto(e),this.oHash.update(e),this.oHash.digestInto(e),this.destroy()}digest(){let e=new Uint8Array(this.oHash.outputLen);return this.digestInto(e),e}_cloneInto(e){e||(e=Object.create(Object.getPrototypeOf(this),{}));let{oHash:r,iHash:n,finished:t,destroyed:i,blockLen:o,outputLen:s}=this;return e=e,e.finished=t,e.destroyed=i,e.blockLen=o,e.outputLen=s,e.oHash=r._cloneInto(e.oHash),e.iHash=n._cloneInto(e.iHash),e}clone(){return this._cloneInto()}destroy(){this.destroyed=!0,this.oHash.destroy(),this.iHash.destroy()}},xt=(e,r,n)=>new Bt(e,r).update(n).digest();xt.create=(e,r)=>new Bt(e,r);var Qe=BigInt(0),$e=BigInt(1);function Re(e,r=""){if(typeof e!="boolean"){let n=r&&`"${r}"`;throw new Error(n+"expected boolean, got type="+typeof e)}return e}function re(e,r,n=""){let t=ke(e),i=e?.length,o=r!==void 0;if(!t||o&&i!==r){let s=n&&`"${n}" `,l=o?` of length ${r}`:"",f=t?`length=${i}`:`type=${typeof e}`;throw new Error(s+"expected Uint8Array"+l+", got "+f)}return e}function Se(e){let r=e.toString(16);return r.length&1?"0"+r:r}function St(e){if(typeof e!="string")throw new Error("hex string expected, got "+typeof e);return e===""?Qe:BigInt("0x"+e)}function pe(e){return St(Z(e))}function Ot(e){return se(e),St(Z(Uint8Array.from(e).reverse()))}function Te(e,r){return ce(e.toString(16).padStart(r*2,"0"))}function At(e,r){return Te(e,r).reverse()}function V(e,r,n){let t;if(typeof r=="string")try{t=ce(r)}catch(o){throw new Error(e+" must be hex string or Uint8Array, cause: "+o)}else if(ke(r))t=Uint8Array.from(r);else throw new Error(e+" must be hex string or Uint8Array");let i=t.length;if(typeof n=="number"&&i!==n)throw new Error(e+" of length "+n+" expected, got "+i);return t}var Pe=e=>typeof e=="bigint"&&Qe<=e;function Ge(e,r,n){return Pe(e)&&Pe(r)&&Pe(n)&&r<=e&&e<n}function gr(e,r,n,t){if(!Ge(r,n,t))throw new Error("expected valid "+e+": "+n+" <= n < "+t+", got "+r)}function It(e){let r;for(r=0;e>Qe;e>>=$e,r+=1);return r}var be=e=>($e<<BigInt(e))-$e;function mr(e,r,n){if(typeof e!="number"||e<2)throw new Error("hashLen must be a number");if(typeof r!="number"||r<2)throw new Error("qByteLen must be a number");if(typeof n!="function")throw new Error("hmacFn must be a function");let t=a=>new Uint8Array(a),i=a=>Uint8Array.of(a),o=t(e),s=t(e),l=0,f=()=>{o.fill(1),s.fill(0),l=0},u=(...a)=>n(s,o,...a),h=(a=t(0))=>{s=u(i(0),a),o=u(),a.length!==0&&(s=u(i(1),a),o=u())},g=()=>{if(l++>=1e3)throw new Error("drbg: tried 1000 values");let a=0,y=[];for(;a<r;){o=u();let v=o.slice();y.push(v),a+=o.length}return $(...y)};return(a,y)=>{f(),h(a);let v;for(;!(v=y(g()));)h();return f(),v}}function _e(e,r,n={}){if(!e||typeof e!="object")throw new Error("expected valid options object");function t(i,o,s){let l=e[i];if(s&&l===void 0)return;let f=typeof l;if(f!==o||l===null)throw new Error(`param "${i}" is invalid: expected ${o}, got ${f}`)}Object.entries(r).forEach(([i,o])=>t(i,o,!1)),Object.entries(n).forEach(([i,o])=>t(i,o,!0))}function lt(e){let r=new WeakMap;return(n,...t)=>{let i=r.get(n);if(i!==void 0)return i;let o=e(n,...t);return r.set(n,o),o}}var H=BigInt(0),K=BigInt(1),ne=BigInt(2),Rt=BigInt(3),Ut=BigInt(4),Nt=BigInt(5),br=BigInt(7),Ft=BigInt(8),Er=BigInt(9),kt=BigInt(16);function j(e,r){let n=e%r;return n>=H?n:r+n}function D(e,r,n){let t=e;for(;r-- >H;)t*=t,t%=n;return t}function ft(e,r){if(e===H)throw new Error("invert: expected non-zero number");if(r<=H)throw new Error("invert: expected positive modulus, got "+r);let n=j(e,r),t=r,i=H,o=K,s=K,l=H;for(;n!==H;){let f=t/n,u=t%n,h=i-s*f,g=o-l*f;t=n,n=u,i=s,o=l,s=h,l=g}if(t!==K)throw new Error("invert: does not exist");return j(i,r)}function et(e,r,n){if(!e.eql(e.sqr(r),n))throw new Error("Cannot find square root")}function qt(e,r){let n=(e.ORDER+K)/Ut,t=e.pow(r,n);return et(e,t,r),t}function vr(e,r){let n=(e.ORDER-Nt)/Ft,t=e.mul(r,ne),i=e.pow(t,n),o=e.mul(r,i),s=e.mul(e.mul(o,ne),i),l=e.mul(o,e.sub(s,e.ONE));return et(e,l,r),l}function Br(e){let r=Ee(e),n=Tt(e),t=n(r,r.neg(r.ONE)),i=n(r,t),o=n(r,r.neg(t)),s=(e+br)/kt;return(l,f)=>{let u=l.pow(f,s),h=l.mul(u,t),g=l.mul(u,i),a=l.mul(u,o),y=l.eql(l.sqr(h),f),v=l.eql(l.sqr(g),f);u=l.cmov(u,h,y),h=l.cmov(a,g,v);let O=l.eql(l.sqr(h),f),I=l.cmov(u,h,O);return et(l,I,f),I}}function Tt(e){if(e<Rt)throw new Error("sqrt is not defined for small field");let r=e-K,n=0;for(;r%ne===H;)r/=ne,n++;let t=ne,i=Ee(e);for(;ut(i,t)===1;)if(t++>1e3)throw new Error("Cannot find square root: probably non-prime P");if(n===1)return qt;let o=i.pow(t,r),s=(r+K)/ne;return function(l,f){if(l.is0(f))return f;if(ut(l,f)!==1)throw new Error("Cannot find square root");let u=n,h=l.mul(l.ONE,o),g=l.pow(f,r),a=l.pow(f,s);for(;!l.eql(g,l.ONE);){if(l.is0(g))return l.ZERO;let y=1,v=l.sqr(g);for(;!l.eql(v,l.ONE);)if(y++,v=l.sqr(v),y===u)throw new Error("Cannot find square root");let O=K<<BigInt(u-y-1),I=l.pow(h,O);u=y,h=l.sqr(I),g=l.mul(g,h),a=l.mul(a,I)}return a}}function xr(e){return e%Ut===Rt?qt:e%Ft===Nt?vr:e%kt===Er?Br(e):Tt(e)}var Sr=["create","isValid","is0","neg","inv","sqrt","sqr","eql","add","sub","mul","pow","div","addN","subN","mulN","sqrN"];function Or(e){let r={ORDER:"bigint",MASK:"bigint",BYTES:"number",BITS:"number"},n=Sr.reduce((t,i)=>(t[i]="function",t),r);return _e(e,n),e}function Ar(e,r,n){if(n<H)throw new Error("invalid exponent, negatives unsupported");if(n===H)return e.ONE;if(n===K)return r;let t=e.ONE,i=r;for(;n>H;)n&K&&(t=e.mul(t,i)),i=e.sqr(i),n>>=K;return t}function Lt(e,r,n=!1){let t=new Array(r.length).fill(n?e.ZERO:void 0),i=r.reduce((s,l,f)=>e.is0(l)?s:(t[f]=s,e.mul(s,l)),e.ONE),o=e.inv(i);return r.reduceRight((s,l,f)=>e.is0(l)?s:(t[f]=e.mul(s,t[f]),e.mul(s,l)),o),t}function ut(e,r){let n=(e.ORDER-K)/ne,t=e.pow(r,n),i=e.eql(t,e.ONE),o=e.eql(t,e.ZERO),s=e.eql(t,e.neg(e.ONE));if(!i&&!o&&!s)throw new Error("invalid Legendre symbol result");return i?1:o?0:-1}function Ct(e,r){r!==void 0&&Ye(r);let n=r!==void 0?r:e.toString(2).length,t=Math.ceil(n/8);return{nBitLength:n,nByteLength:t}}function Ee(e,r,n=!1,t={}){if(e<=H)throw new Error("invalid field: expected ORDER > 0, got "+e);let i,o,s=!1,l;if(typeof r=="object"&&r!=null){if(t.sqrt||n)throw new Error("cannot specify opts in two arguments");let a=r;a.BITS&&(i=a.BITS),a.sqrt&&(o=a.sqrt),typeof a.isLE=="boolean"&&(n=a.isLE),typeof a.modFromBytes=="boolean"&&(s=a.modFromBytes),l=a.allowedLengths}else typeof r=="number"&&(i=r),t.sqrt&&(o=t.sqrt);let{nBitLength:f,nByteLength:u}=Ct(e,i);if(u>2048)throw new Error("invalid field: expected ORDER of <= 2048 bytes");let h,g=Object.freeze({ORDER:e,isLE:n,BITS:f,BYTES:u,MASK:be(f),ZERO:H,ONE:K,allowedLengths:l,create:a=>j(a,e),isValid:a=>{if(typeof a!="bigint")throw new Error("invalid field element: expected bigint, got "+typeof a);return H<=a&&a<e},is0:a=>a===H,isValidNot0:a=>!g.is0(a)&&g.isValid(a),isOdd:a=>(a&K)===K,neg:a=>j(-a,e),eql:(a,y)=>a===y,sqr:a=>j(a*a,e),add:(a,y)=>j(a+y,e),sub:(a,y)=>j(a-y,e),mul:(a,y)=>j(a*y,e),pow:(a,y)=>Ar(g,a,y),div:(a,y)=>j(a*ft(y,e),e),sqrN:a=>a*a,addN:(a,y)=>a+y,subN:(a,y)=>a-y,mulN:(a,y)=>a*y,inv:a=>ft(a,e),sqrt:o||(a=>(h||(h=xr(e)),h(g,a))),toBytes:a=>n?At(a,u):Te(a,u),fromBytes:(a,y=!0)=>{if(l){if(!l.includes(a.length)||a.length>u)throw new Error("Field.fromBytes: expected "+l+" bytes, got "+a.length);let O=new Uint8Array(u);O.set(a,n?0:O.length-a.length),a=O}if(a.length!==u)throw new Error("Field.fromBytes: expected "+u+" bytes, got "+a.length);let v=n?Ot(a):pe(a);if(s&&(v=j(v,e)),!y&&!g.isValid(v))throw new Error("invalid field element: outside of range 0..ORDER");return v},invertBatch:a=>Lt(g,a),cmov:(a,y,v)=>v?y:a});return Object.freeze(g)}function Vt(e){if(typeof e!="bigint")throw new Error("field order must be bigint");let r=e.toString(2).length;return Math.ceil(r/8)}function Kt(e){let r=Vt(e);return r+Math.ceil(r/2)}function Pt(e,r,n=!1){let t=e.length,i=Vt(r),o=Kt(r);if(t<16||t<o||t>1024)throw new Error("expected "+o+"-1024 bytes of input, got "+t);let s=n?Ot(e):pe(e),l=j(s,r-K)+K;return n?At(l,i):Te(l,i)}var de=BigInt(0),ie=BigInt(1);function Ue(e,r){let n=r.negate();return e?n:r}function He(e,r){let n=Lt(e.Fp,r.map(t=>t.Z));return r.map((t,i)=>e.fromAffine(t.toAffine(n[i])))}function Ht(e,r){if(!Number.isSafeInteger(e)||e<=0||e>r)throw new Error("invalid window size, expected [1.."+r+"], got W="+e)}function Ze(e,r){Ht(e,r);let n=Math.ceil(r/e)+1,t=2**(e-1),i=2**e,o=be(e),s=BigInt(e);return{windows:n,windowSize:t,mask:o,maxNumber:i,shiftBy:s}}function ct(e,r,n){let{windowSize:t,mask:i,maxNumber:o,shiftBy:s}=n,l=Number(e&i),f=e>>s;l>t&&(l-=o,f+=ie);let u=r*t,h=u+Math.abs(l)-1,g=l===0,a=l<0,y=r%2!==0;return{nextN:f,offset:h,isZero:g,isNeg:a,isNegF:y,offsetF:u}}function Ir(e,r){if(!Array.isArray(e))throw new Error("array expected");e.forEach((n,t)=>{if(!(n instanceof r))throw new Error("invalid point at index "+t)})}function Rr(e,r){if(!Array.isArray(e))throw new Error("array of scalars expected");e.forEach((n,t)=>{if(!r.isValid(n))throw new Error("invalid scalar at index "+t)})}var De=new WeakMap,Zt=new WeakMap;function je(e){return Zt.get(e)||1}function dt(e){if(e!==de)throw new Error("invalid wNAF")}var Ur=class{constructor(e,r){this.BASE=e.BASE,this.ZERO=e.ZERO,this.Fn=e.Fn,this.bits=r}_unsafeLadder(e,r,n=this.ZERO){let t=e;for(;r>de;)r&ie&&(n=n.add(t)),t=t.double(),r>>=ie;return n}precomputeWindow(e,r){let{windows:n,windowSize:t}=Ze(r,this.bits),i=[],o=e,s=o;for(let l=0;l<n;l++){s=o,i.push(s);for(let f=1;f<t;f++)s=s.add(o),i.push(s);o=s.double()}return i}wNAF(e,r,n){if(!this.Fn.isValid(n))throw new Error("invalid scalar");let t=this.ZERO,i=this.BASE,o=Ze(e,this.bits);for(let s=0;s<o.windows;s++){let{nextN:l,offset:f,isZero:u,isNeg:h,isNegF:g,offsetF:a}=ct(n,s,o);n=l,u?i=i.add(Ue(g,r[a])):t=t.add(Ue(h,r[f]))}return dt(n),{p:t,f:i}}wNAFUnsafe(e,r,n,t=this.ZERO){let i=Ze(e,this.bits);for(let o=0;o<i.windows&&n!==de;o++){let{nextN:s,offset:l,isZero:f,isNeg:u}=ct(n,o,i);if(n=s,!f){let h=r[l];t=t.add(u?h.negate():h)}}return dt(n),t}getPrecomputes(e,r,n){let t=De.get(r);return t||(t=this.precomputeWindow(r,e),e!==1&&(typeof n=="function"&&(t=n(t)),De.set(r,t))),t}cached(e,r,n){let t=je(e);return this.wNAF(t,this.getPrecomputes(t,e,n),r)}unsafe(e,r,n,t){let i=je(e);return i===1?this._unsafeLadder(e,r,t):this.wNAFUnsafe(i,this.getPrecomputes(i,e,n),r,t)}createCache(e,r){Ht(r,this.bits),Zt.set(e,r),De.delete(e)}hasCache(e){return je(e)!==1}};function Nr(e,r,n,t){let i=r,o=e.ZERO,s=e.ZERO;for(;n>de||t>de;)n&ie&&(o=o.add(i)),t&ie&&(s=s.add(i)),i=i.double(),n>>=ie,t>>=ie;return{p1:o,p2:s}}function Fr(e,r,n,t){Ir(n,e),Rr(t,r);let i=n.length,o=t.length;if(i!==o)throw new Error("arrays of points and scalars must have equal length");let s=e.ZERO,l=It(BigInt(i)),f=1;l>12?f=l-3:l>4?f=l-2:l>0&&(f=2);let u=be(f),h=new Array(Number(u)+1).fill(s),g=Math.floor((r.BITS-1)/f)*f,a=s;for(let y=g;y>=0;y-=f){h.fill(s);for(let O=0;O<o;O++){let I=t[O],q=Number(I>>BigInt(y)&u);h[q]=h[q].add(n[O])}let v=s;for(let O=h.length-1,I=s;O>0;O--)I=I.add(h[O]),v=v.add(I);if(a=a.add(v),y!==0)for(let O=0;O<f;O++)a=a.double()}return a}function ht(e,r,n){if(r){if(r.ORDER!==e)throw new Error("Field.ORDER must match order: Fp == p, Fn == n");return Or(r),r}else return Ee(e,{isLE:n})}function kr(e,r,n={},t){if(t===void 0&&(t=e==="edwards"),!r||typeof r!="object")throw new Error(`expected valid ${e} CURVE object`);for(let l of["p","n","h"]){let f=r[l];if(!(typeof f=="bigint"&&f>de))throw new Error(`CURVE.${l} must be positive bigint`)}let i=ht(r.p,n.Fp,t),o=ht(r.n,n.Fn,t),s=["Gx","Gy","a",e==="weierstrass"?"b":"d"];for(let l of s)if(!i.isValid(r[l]))throw new Error(`CURVE.${l} must be valid field element of CURVE.Fp`);return r=Object.freeze(Object.assign({},r)),{CURVE:r,Fp:i,Fn:o}}var pt=(e,r)=>(e+(e>=0?r:-r)/Dt)/r;function qr(e,r,n){let[[t,i],[o,s]]=r,l=pt(s*e,n),f=pt(-i*e,n),u=e-l*t-f*o,h=-l*i-f*s,g=u<X,a=h<X;g&&(u=-u),a&&(h=-h);let y=be(Math.ceil(It(n)/2))+ue;if(u<X||u>=y||h<X||h>=y)throw new Error("splitScalar (endomorphism): failed, k="+e);return{k1neg:g,k1:u,k2neg:a,k2:h}}function Me(e){if(!["compact","recovered","der"].includes(e))throw new Error('Signature format must be "compact", "recovered", or "der"');return e}function ze(e,r){let n={};for(let t of Object.keys(r))n[t]=e[t]===void 0?r[t]:e[t];return Re(n.lowS,"lowS"),Re(n.prehash,"prehash"),n.format!==void 0&&Me(n.format),n}var Tr=class extends Error{constructor(e=""){super(e)}},M={Err:Tr,_tlv:{encode:(e,r)=>{let{Err:n}=M;if(e<0||e>256)throw new n("tlv.encode: wrong tag");if(r.length&1)throw new n("tlv.encode: unpadded data");let t=r.length/2,i=Se(t);if(i.length/2&128)throw new n("tlv.encode: long form length too big");let o=t>127?Se(i.length/2|128):"";return Se(e)+o+i+r},decode(e,r){let{Err:n}=M,t=0;if(e<0||e>256)throw new n("tlv.encode: wrong tag");if(r.length<2||r[t++]!==e)throw new n("tlv.decode: wrong tlv");let i=r[t++],o=!!(i&128),s=0;if(!o)s=i;else{let f=i&127;if(!f)throw new n("tlv.decode(long): indefinite length not supported");if(f>4)throw new n("tlv.decode(long): byte length is too big");let u=r.subarray(t,t+f);if(u.length!==f)throw new n("tlv.decode: length bytes not complete");if(u[0]===0)throw new n("tlv.decode(long): zero leftmost byte");for(let h of u)s=s<<8|h;if(t+=f,s<128)throw new n("tlv.decode(long): not minimal encoding")}let l=r.subarray(t,t+s);if(l.length!==s)throw new n("tlv.decode: wrong value length");return{v:l,l:r.subarray(t+s)}}},_int:{encode(e){let{Err:r}=M;if(e<X)throw new r("integer: negative integers are not allowed");let n=Se(e);if(Number.parseInt(n[0],16)&8&&(n="00"+n),n.length&1)throw new r("unexpected DER parsing assertion: unpadded hex");return n},decode(e){let{Err:r}=M;if(e[0]&128)throw new r("invalid signature integer: negative");if(e[0]===0&&!(e[1]&128))throw new r("invalid signature integer: unnecessary leading zero");return pe(e)}},toSig(e){let{Err:r,_int:n,_tlv:t}=M,i=V("signature",e),{v:o,l:s}=t.decode(48,i);if(s.length)throw new r("invalid signature: left bytes after parsing");let{v:l,l:f}=t.decode(2,o),{v:u,l:h}=t.decode(2,f);if(h.length)throw new r("invalid signature: left bytes after parsing");return{r:n.decode(l),s:n.decode(u)}},hexFromSig(e){let{_tlv:r,_int:n}=M,t=r.encode(2,n.encode(e.r)),i=r.encode(2,n.encode(e.s)),o=t+i;return r.encode(48,o)}},X=BigInt(0),ue=BigInt(1),Dt=BigInt(2),Oe=BigInt(3),Lr=BigInt(4);function oe(e,r){let{BYTES:n}=e,t;if(typeof r=="bigint")t=r;else{let i=V("private key",r);try{t=e.fromBytes(i)}catch{throw new Error(`invalid private key: expected ui8a of size ${n}, got ${typeof r}`)}}if(!e.isValidNot0(t))throw new Error("invalid private key: out of range [1..N-1]");return t}function Cr(e,r={}){let n=kr("weierstrass",e,r),{Fp:t,Fn:i}=n,o=n.CURVE,{h:s,n:l}=o;_e(r,{},{allowInfinityPoint:"boolean",clearCofactor:"function",isTorsionFree:"function",fromBytes:"function",toBytes:"function",endo:"object",wrapPrivateKey:"boolean"});let{endo:f}=r;if(f&&(!t.is0(o.a)||typeof f.beta!="bigint"||!Array.isArray(f.basises)))throw new Error('invalid endo: expected "beta": bigint and "basises": array');let u=zt(t,i);function h(){if(!t.isOdd)throw new Error("compression is not supported: Field does not have .isOdd()")}function g(U,p,c){let{x:d,y:w}=p.toAffine(),b=t.toBytes(d);if(Re(c,"isCompressed"),c){h();let B=!t.isOdd(w);return $(jt(B),b)}else return $(Uint8Array.of(4),b,t.toBytes(w))}function a(U){re(U,void 0,"Point");let{publicKey:p,publicKeyUncompressed:c}=u,d=U.length,w=U[0],b=U.subarray(1);if(d===p&&(w===2||w===3)){let B=t.fromBytes(b);if(!t.isValid(B))throw new Error("bad point: is not on curve, wrong x");let E=O(B),m;try{m=t.sqrt(E)}catch(S){let C=S instanceof Error?": "+S.message:"";throw new Error("bad point: is not on curve, sqrt error"+C)}h();let x=t.isOdd(m);return(w&1)===1!==x&&(m=t.neg(m)),{x:B,y:m}}else if(d===c&&w===4){let B=t.BYTES,E=t.fromBytes(b.subarray(0,B)),m=t.fromBytes(b.subarray(B,B*2));if(!I(E,m))throw new Error("bad point: is not on curve");return{x:E,y:m}}else throw new Error(`bad point: got length ${d}, expected compressed=${p} or uncompressed=${c}`)}let y=r.toBytes||g,v=r.fromBytes||a;function O(U){let p=t.sqr(U),c=t.mul(p,U);return t.add(t.add(c,t.mul(U,o.a)),o.b)}function I(U,p){let c=t.sqr(p),d=O(U);return t.eql(c,d)}if(!I(o.Gx,o.Gy))throw new Error("bad curve params: generator point");let q=t.mul(t.pow(o.a,Oe),Lr),ge=t.mul(t.sqr(o.b),BigInt(27));if(t.is0(t.add(q,ge)))throw new Error("bad curve params: a or b");function L(U,p,c=!1){if(!t.isValid(p)||c&&t.is0(p))throw new Error(`bad point coordinate ${U}`);return p}function ee(U){if(!(U instanceof A))throw new Error("ProjectivePoint expected")}function J(U){if(!f||!f.basises)throw new Error("no endo");return qr(U,f.basises,i.ORDER)}let ae=lt((U,p)=>{let{X:c,Y:d,Z:w}=U;if(t.eql(w,t.ONE))return{x:c,y:d};let b=U.is0();p==null&&(p=b?t.ONE:t.inv(w));let B=t.mul(c,p),E=t.mul(d,p),m=t.mul(w,p);if(b)return{x:t.ZERO,y:t.ZERO};if(!t.eql(m,t.ONE))throw new Error("invZ was invalid");return{x:B,y:E}}),ve=lt(U=>{if(U.is0()){if(r.allowInfinityPoint&&!t.is0(U.Y))return;throw new Error("bad point: ZERO")}let{x:p,y:c}=U.toAffine();if(!t.isValid(p)||!t.isValid(c))throw new Error("bad point: x or y not field elements");if(!I(p,c))throw new Error("bad point: equation left != right");if(!U.isTorsionFree())throw new Error("bad point: not in prime-order subgroup");return!0});function le(U,p,c,d,w){return c=new A(t.mul(c.X,U),c.Y,c.Z),p=Ue(d,p),c=Ue(w,c),p.add(c)}class A{constructor(p,c,d){this.X=L("x",p),this.Y=L("y",c,!0),this.Z=L("z",d),Object.freeze(this)}static CURVE(){return o}static fromAffine(p){let{x:c,y:d}=p||{};if(!p||!t.isValid(c)||!t.isValid(d))throw new Error("invalid affine point");if(p instanceof A)throw new Error("projective point not allowed");return t.is0(c)&&t.is0(d)?A.ZERO:new A(c,d,t.ONE)}static fromBytes(p){let c=A.fromAffine(v(re(p,void 0,"point")));return c.assertValidity(),c}static fromHex(p){return A.fromBytes(V("pointHex",p))}get x(){return this.toAffine().x}get y(){return this.toAffine().y}precompute(p=8,c=!0){return te.createCache(this,p),c||this.multiply(Oe),this}assertValidity(){ve(this)}hasEvenY(){let{y:p}=this.toAffine();if(!t.isOdd)throw new Error("Field doesn't support isOdd");return!t.isOdd(p)}equals(p){ee(p);let{X:c,Y:d,Z:w}=this,{X:b,Y:B,Z:E}=p,m=t.eql(t.mul(c,E),t.mul(b,w)),x=t.eql(t.mul(d,E),t.mul(B,w));return m&&x}negate(){return new A(this.X,t.neg(this.Y),this.Z)}double(){let{a:p,b:c}=o,d=t.mul(c,Oe),{X:w,Y:b,Z:B}=this,E=t.ZERO,m=t.ZERO,x=t.ZERO,S=t.mul(w,w),C=t.mul(b,b),N=t.mul(B,B),R=t.mul(w,b);return R=t.add(R,R),x=t.mul(w,B),x=t.add(x,x),E=t.mul(p,x),m=t.mul(d,N),m=t.add(E,m),E=t.sub(C,m),m=t.add(C,m),m=t.mul(E,m),E=t.mul(R,E),x=t.mul(d,x),N=t.mul(p,N),R=t.sub(S,N),R=t.mul(p,R),R=t.add(R,x),x=t.add(S,S),S=t.add(x,S),S=t.add(S,N),S=t.mul(S,R),m=t.add(m,S),N=t.mul(b,B),N=t.add(N,N),S=t.mul(N,R),E=t.sub(E,S),x=t.mul(N,C),x=t.add(x,x),x=t.add(x,x),new A(E,m,x)}add(p){ee(p);let{X:c,Y:d,Z:w}=this,{X:b,Y:B,Z:E}=p,m=t.ZERO,x=t.ZERO,S=t.ZERO,C=o.a,N=t.mul(o.b,Oe),R=t.mul(c,b),F=t.mul(d,B),T=t.mul(w,E),z=t.add(c,d),k=t.add(b,B);z=t.mul(z,k),k=t.add(R,F),z=t.sub(z,k),k=t.add(c,w);let P=t.add(b,E);return k=t.mul(k,P),P=t.add(R,T),k=t.sub(k,P),P=t.add(d,w),m=t.add(B,E),P=t.mul(P,m),m=t.add(F,T),P=t.sub(P,m),S=t.mul(C,k),m=t.mul(N,T),S=t.add(m,S),m=t.sub(F,S),S=t.add(F,S),x=t.mul(m,S),F=t.add(R,R),F=t.add(F,R),T=t.mul(C,T),k=t.mul(N,k),F=t.add(F,T),T=t.sub(R,T),T=t.mul(C,T),k=t.add(k,T),R=t.mul(F,k),x=t.add(x,R),R=t.mul(P,k),m=t.mul(z,m),m=t.sub(m,R),R=t.mul(z,F),S=t.mul(P,S),S=t.add(S,R),new A(m,x,S)}subtract(p){return this.add(p.negate())}is0(){return this.equals(A.ZERO)}multiply(p){let{endo:c}=r;if(!i.isValidNot0(p))throw new Error("invalid scalar: out of range");let d,w,b=B=>te.cached(this,B,E=>He(A,E));if(c){let{k1neg:B,k1:E,k2neg:m,k2:x}=J(p),{p:S,f:C}=b(E),{p:N,f:R}=b(x);w=C.add(R),d=le(c.beta,S,N,B,m)}else{let{p:B,f:E}=b(p);d=B,w=E}return He(A,[d,w])[0]}multiplyUnsafe(p){let{endo:c}=r,d=this;if(!i.isValid(p))throw new Error("invalid scalar: out of range");if(p===X||d.is0())return A.ZERO;if(p===ue)return d;if(te.hasCache(this))return this.multiply(p);if(c){let{k1neg:w,k1:b,k2neg:B,k2:E}=J(p),{p1:m,p2:x}=Nr(A,d,b,E);return le(c.beta,m,x,w,B)}else return te.unsafe(d,p)}multiplyAndAddUnsafe(p,c,d){let w=this.multiplyUnsafe(c).add(p.multiplyUnsafe(d));return w.is0()?void 0:w}toAffine(p){return ae(this,p)}isTorsionFree(){let{isTorsionFree:p}=r;return s===ue?!0:p?p(A,this):te.unsafe(this,l).is0()}clearCofactor(){let{clearCofactor:p}=r;return s===ue?this:p?p(A,this):this.multiplyUnsafe(s)}isSmallOrder(){return this.multiplyUnsafe(s).is0()}toBytes(p=!0){return Re(p,"isCompressed"),this.assertValidity(),y(A,this,p)}toHex(p=!0){return Z(this.toBytes(p))}toString(){return`<Point ${this.is0()?"ZERO":this.toHex()}>`}get px(){return this.X}get py(){return this.X}get pz(){return this.Z}toRawBytes(p=!0){return this.toBytes(p)}_setWindowSize(p){this.precompute(p)}static normalizeZ(p){return He(A,p)}static msm(p,c){return Fr(A,i,p,c)}static fromPrivateKey(p){return A.BASE.multiply(oe(i,p))}}A.BASE=new A(o.Gx,o.Gy,t.ONE),A.ZERO=new A(t.ZERO,t.ONE,t.ZERO),A.Fp=t,A.Fn=i;let Be=i.BITS,te=new Ur(A,r.endo?Math.ceil(Be/2):Be);return A.BASE.precompute(8),A}function jt(e){return Uint8Array.of(e?2:3)}function zt(e,r){return{secretKey:r.BYTES,publicKey:1+e.BYTES,publicKeyUncompressed:1+2*e.BYTES,publicKeyHasPrefix:!0,signature:2*r.BYTES}}function Vr(e,r={}){let{Fn:n}=e,t=r.randomBytes||qe,i=Object.assign(zt(e.Fp,n),{seed:Kt(n.ORDER)});function o(a){try{return!!oe(n,a)}catch{return!1}}function s(a,y){let{publicKey:v,publicKeyUncompressed:O}=i;try{let I=a.length;return y===!0&&I!==v||y===!1&&I!==O?!1:!!e.fromBytes(a)}catch{return!1}}function l(a=t(i.seed)){return Pt(re(a,i.seed,"seed"),n.ORDER)}function f(a,y=!0){return e.BASE.multiply(oe(n,a)).toBytes(y)}function u(a){let y=l(a);return{secretKey:y,publicKey:f(y)}}function h(a){if(typeof a=="bigint")return!1;if(a instanceof e)return!0;let{secretKey:y,publicKey:v,publicKeyUncompressed:O}=i;if(n.allowedLengths||y===v)return;let I=V("key",a).length;return I===v||I===O}function g(a,y,v=!0){if(h(a)===!0)throw new Error("first arg must be private key");if(h(y)===!1)throw new Error("second arg must be public key");let O=oe(n,a);return e.fromHex(y).multiply(O).toBytes(v)}return Object.freeze({getPublicKey:f,getSharedSecret:g,keygen:u,Point:e,utils:{isValidSecretKey:o,isValidPublicKey:s,randomSecretKey:l,isValidPrivateKey:o,randomPrivateKey:l,normPrivateKeyToScalar:a=>oe(n,a),precompute(a=8,y=e.BASE){return y.precompute(a,!1)}},lengths:i})}function Kr(e,r,n={}){mt(r),_e(n,{},{hmac:"function",lowS:"boolean",randomBytes:"function",bits2int:"function",bits2int_modN:"function"});let t=n.randomBytes||qe,i=n.hmac||((c,...d)=>xt(r,c,$(...d))),{Fp:o,Fn:s}=e,{ORDER:l,BITS:f}=s,{keygen:u,getPublicKey:h,getSharedSecret:g,utils:a,lengths:y}=Vr(e,n),v={prehash:!1,lowS:typeof n.lowS=="boolean"?n.lowS:!1,format:void 0,extraEntropy:!1},O="compact";function I(c){let d=l>>ue;return c>d}function q(c,d){if(!s.isValidNot0(d))throw new Error(`invalid signature ${c}: out of range 1..Point.Fn.ORDER`);return d}function ge(c,d){Me(d);let w=y.signature,b=d==="compact"?w:d==="recovered"?w+1:void 0;return re(c,b,`${d} signature`)}class L{constructor(d,w,b){this.r=q("r",d),this.s=q("s",w),b!=null&&(this.recovery=b),Object.freeze(this)}static fromBytes(d,w=O){ge(d,w);let b;if(w==="der"){let{r:x,s:S}=M.toSig(re(d));return new L(x,S)}w==="recovered"&&(b=d[0],w="compact",d=d.subarray(1));let B=s.BYTES,E=d.subarray(0,B),m=d.subarray(B,B*2);return new L(s.fromBytes(E),s.fromBytes(m),b)}static fromHex(d,w){return this.fromBytes(ce(d),w)}addRecoveryBit(d){return new L(this.r,this.s,d)}recoverPublicKey(d){let w=o.ORDER,{r:b,s:B,recovery:E}=this;if(E==null||![0,1,2,3].includes(E))throw new Error("recovery id invalid");if(l*Dt<w&&E>1)throw new Error("recovery id is ambiguous for h>1 curve");let m=E===2||E===3?b+l:b;if(!o.isValid(m))throw new Error("recovery id 2 or 3 invalid");let x=o.toBytes(m),S=e.fromBytes($(jt((E&1)===0),x)),C=s.inv(m),N=J(V("msgHash",d)),R=s.create(-N*C),F=s.create(B*C),T=e.BASE.multiplyUnsafe(R).add(S.multiplyUnsafe(F));if(T.is0())throw new Error("point at infinify");return T.assertValidity(),T}hasHighS(){return I(this.s)}toBytes(d=O){if(Me(d),d==="der")return ce(M.hexFromSig(this));let w=s.toBytes(this.r),b=s.toBytes(this.s);if(d==="recovered"){if(this.recovery==null)throw new Error("recovery bit must be present");return $(Uint8Array.of(this.recovery),w,b)}return $(w,b)}toHex(d){return Z(this.toBytes(d))}assertValidity(){}static fromCompact(d){return L.fromBytes(V("sig",d),"compact")}static fromDER(d){return L.fromBytes(V("sig",d),"der")}normalizeS(){return this.hasHighS()?new L(this.r,s.neg(this.s),this.recovery):this}toDERRawBytes(){return this.toBytes("der")}toDERHex(){return Z(this.toBytes("der"))}toCompactRawBytes(){return this.toBytes("compact")}toCompactHex(){return Z(this.toBytes("compact"))}}let ee=n.bits2int||function(c){if(c.length>8192)throw new Error("input is too large");let d=pe(c),w=c.length*8-f;return w>0?d>>BigInt(w):d},J=n.bits2int_modN||function(c){return s.create(ee(c))},ae=be(f);function ve(c){return gr("num < 2^"+f,c,X,ae),s.toBytes(c)}function le(c,d){return re(c,void 0,"message"),d?re(r(c),void 0,"prehashed message"):c}function A(c,d,w){if(["recovered","canonical"].some(F=>F in w))throw new Error("sign() legacy options not supported");let{lowS:b,prehash:B,extraEntropy:E}=ze(w,v);c=le(c,B);let m=J(c),x=oe(s,d),S=[ve(x),ve(m)];if(E!=null&&E!==!1){let F=E===!0?t(y.secretKey):E;S.push(V("extraEntropy",F))}let C=$(...S),N=m;function R(F){let T=ee(F);if(!s.isValidNot0(T))return;let z=s.inv(T),k=e.BASE.multiply(T).toAffine(),P=s.create(k.x);if(P===X)return;let xe=s.create(z*s.create(N+P*x));if(xe===X)return;let ot=(k.x===P?0:2)|Number(k.y&ue),st=xe;return b&&I(xe)&&(st=s.neg(xe),ot^=1),new L(P,st,ot)}return{seed:C,k2sig:R}}function Be(c,d,w={}){c=V("message",c);let{seed:b,k2sig:B}=A(c,d,w);return mr(r.outputLen,s.BYTES,i)(b,B)}function te(c){let d,w=typeof c=="string"||ke(c),b=!w&&c!==null&&typeof c=="object"&&typeof c.r=="bigint"&&typeof c.s=="bigint";if(!w&&!b)throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");if(b)d=new L(c.r,c.s);else if(w){try{d=L.fromBytes(V("sig",c),"der")}catch(B){if(!(B instanceof M.Err))throw B}if(!d)try{d=L.fromBytes(V("sig",c),"compact")}catch{return!1}}return d||!1}function U(c,d,w,b={}){let{lowS:B,prehash:E,format:m}=ze(b,v);if(w=V("publicKey",w),d=le(V("message",d),E),"strict"in b)throw new Error("options.strict was renamed to lowS");let x=m===void 0?te(c):L.fromBytes(V("sig",c),m);if(x===!1)return!1;try{let S=e.fromBytes(w);if(B&&x.hasHighS())return!1;let{r:C,s:N}=x,R=J(d),F=s.inv(N),T=s.create(R*F),z=s.create(C*F),k=e.BASE.multiplyUnsafe(T).add(S.multiplyUnsafe(z));return k.is0()?!1:s.create(k.x)===C}catch{return!1}}function p(c,d,w={}){let{prehash:b}=ze(w,v);return d=le(d,b),L.fromBytes(c,"recovered").recoverPublicKey(d).toBytes()}return Object.freeze({keygen:u,getPublicKey:h,getSharedSecret:g,utils:a,lengths:y,Point:e,sign:Be,verify:U,recoverPublicKey:p,Signature:L,hash:r})}function Pr(e){let r={a:e.a,b:e.b,p:e.Fp.ORDER,n:e.n,h:e.h,Gx:e.Gx,Gy:e.Gy},n=e.Fp,t=e.allowedPrivateKeyLengths?Array.from(new Set(e.allowedPrivateKeyLengths.map(s=>Math.ceil(s/2)))):void 0,i=Ee(r.n,{BITS:e.nBitLength,allowedLengths:t,modFromBytes:e.wrapPrivateKey}),o={Fp:n,Fn:i,allowInfinityPoint:e.allowInfinityPoint,endo:e.endo,isTorsionFree:e.isTorsionFree,clearCofactor:e.clearCofactor,fromBytes:e.fromBytes,toBytes:e.toBytes};return{CURVE:r,curveOpts:o}}function Hr(e){let{CURVE:r,curveOpts:n}=Pr(e),t={hmac:e.hmac,randomBytes:e.randomBytes,lowS:e.lowS,bits2int:e.bits2int,bits2int_modN:e.bits2int_modN};return{CURVE:r,curveOpts:n,hash:e.hash,ecdsaOpts:t}}function Zr(e,r){let n=r.Point;return Object.assign({},r,{ProjectivePoint:n,CURVE:Object.assign({},e,Ct(n.Fn.ORDER,n.Fn.BITS))})}function Dr(e){let{CURVE:r,curveOpts:n,hash:t,ecdsaOpts:i}=Hr(e),o=Cr(r,n),s=Kr(o,t,i);return Zr(e,s)}function jr(e,r){let n=t=>Dr({...e,hash:t});return{...n(r),create:n}}var he={p:BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),n:BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),h:BigInt(1),a:BigInt(0),b:BigInt(7),Gx:BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),Gy:BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")},zr={beta:BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),basises:[[BigInt("0x3086d221a7d46bcde86c90e49284eb15"),-BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],[BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"),BigInt("0x3086d221a7d46bcde86c90e49284eb15")]]},Yr=BigInt(0),yt=BigInt(1),Xe=BigInt(2);function $r(e){let r=he.p,n=BigInt(3),t=BigInt(6),i=BigInt(11),o=BigInt(22),s=BigInt(23),l=BigInt(44),f=BigInt(88),u=e*e*e%r,h=u*u*e%r,g=D(h,n,r)*h%r,a=D(g,n,r)*h%r,y=D(a,Xe,r)*u%r,v=D(y,i,r)*y%r,O=D(v,o,r)*v%r,I=D(O,l,r)*O%r,q=D(I,f,r)*I%r,ge=D(q,l,r)*O%r,L=D(ge,n,r)*h%r,ee=D(L,s,r)*v%r,J=D(ee,t,r)*u%r,ae=D(J,Xe,r);if(!Ne.eql(Ne.sqr(ae),e))throw new Error("Cannot find square root");return ae}var Ne=Ee(he.p,{sqrt:$r}),Yt=jr({...he,Fp:Ne,lowS:!0,endo:zr},W),wt={};function Fe(e,...r){let n=wt[e];if(n===void 0){let t=W(Et(e));n=$(t,t),wt[e]=n}return W($(n,...r))}var tt=e=>e.toBytes(!0).slice(1),ye=Yt.Point,rt=e=>e%Xe===Yr;function We(e){let{Fn:r,BASE:n}=ye,t=oe(r,e),i=n.multiply(t);return{scalar:rt(i.y)?t:r.neg(t),bytes:tt(i)}}function $t(e){let r=Ne;if(!r.isValidNot0(e))throw new Error("invalid x: Fail if x \u2265 p");let n=r.create(e*e),t=r.create(n*e+BigInt(7)),i=r.sqrt(t);rt(i)||(i=r.neg(i));let o=ye.fromAffine({x:e,y:i});return o.assertValidity(),o}var me=pe;function Gt(...e){return ye.Fn.create(me(Fe("BIP0340/challenge",...e)))}function gt(e){return We(e).bytes}function Gr(e,r,n=qe(32)){let{Fn:t}=ye,i=V("message",e),{bytes:o,scalar:s}=We(r),l=V("auxRand",n,32),f=t.toBytes(s^me(Fe("BIP0340/aux",l))),u=Fe("BIP0340/nonce",f,o,i),{bytes:h,scalar:g}=We(u),a=Gt(h,o,i),y=new Uint8Array(64);if(y.set(h,0),y.set(t.toBytes(t.create(g+a*s)),32),!Mt(y,i,o))throw new Error("sign: Invalid signature produced");return y}function Mt(e,r,n){let{Fn:t,BASE:i}=ye,o=V("signature",e,64),s=V("message",r),l=V("publicKey",n,32);try{let f=$t(me(l)),u=me(o.subarray(0,32));if(!Ge(u,yt,he.p))return!1;let h=me(o.subarray(32,64));if(!Ge(h,yt,he.n))return!1;let g=Gt(t.toBytes(u),tt(f),s),a=i.multiplyUnsafe(h).add(f.multiplyUnsafe(t.neg(g))),{x:y,y:v}=a.toAffine();return!(a.is0()||!rt(v)||y!==u)}catch{return!1}}var Le=(()=>{let e=(n=qe(48))=>Pt(n,he.n);Yt.utils.randomSecretKey;function r(n){let t=e(n);return{secretKey:t,publicKey:gt(t)}}return{keygen:r,getPublicKey:gt,sign:Gr,verify:Mt,Point:ye,utils:{randomSecretKey:e,randomPrivateKey:e,taggedHash:Fe,lift_x:$t,pointToBytes:tt,numberToBytesBE:Te,bytesToNumberBE:pe,mod:j},lengths:{secretKey:32,publicKey:32,publicKeyHasPrefix:!1,signature:64,seed:48}}})();var nt=["wss://relay.primal.net","wss://nos.lol","wss://relay.damus.io","wss://nostr.mom","wss://relay.nostr.band"],Ce=30078,we=new TextEncoder,Mr=new TextDecoder,Jt=e=>/^[a-f0-9]{64}$/.test(e||"");function Xr(){return Z(crypto.getRandomValues(new Uint8Array(32)))}var Xt=e=>{let r="";for(let n=0;n<e.length;n+=32768)r+=String.fromCharCode.apply(null,e.subarray(n,n+32768));return btoa(r)},Wt=e=>Uint8Array.from(atob(e),r=>r.charCodeAt(0));async function it(e){if(!Jt(e))throw new Error("Invalid sync key");let r=ce(e),n=W(new Uint8Array([...we.encode("spotplus-sync-sign:"),...r])),t=Z(W(new Uint8Array([...we.encode("spotplus-sync-address:"),...r]))).slice(0,40),i=await crypto.subtle.importKey("raw",W(new Uint8Array([...we.encode("spotplus-sync-encrypt:"),...r])),"AES-GCM",!1,["encrypt","decrypt"]);return{secret:n,pubkey:Z(Le.getPublicKey(n)),address:t,key:i}}async function Qt(e,r){let n=new Blob([e]).stream().pipeThrough(r==="c"?new CompressionStream("gzip"):new DecompressionStream("gzip"));return new Uint8Array(await new Response(n).arrayBuffer())}async function _t(e,r){let n=crypto.getRandomValues(new Uint8Array(12)),t=await Qt(we.encode(JSON.stringify(r)),"c"),i=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:n},e.key,t));return Xt(n)+"."+Xt(i)}async function er(e,r){let[n,t]=String(r).split("."),i=new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:Wt(n)},e.key,Wt(t)));if(i.length>2e6)throw new Error("Snapshot too large");let o=Mr.decode(await Qt(i,"d"));if(o.length>4e6)throw new Error("Snapshot too large");return JSON.parse(o)}function Wr(e,r,n=Math.floor(Date.now()/1e3)){let t=[["d",e.address]],i=Z(W(we.encode(JSON.stringify([0,e.pubkey,n,Ce,t,r]))));return{id:i,pubkey:e.pubkey,created_at:n,kind:Ce,tags:t,content:r,sig:Z(Le.sign(i,e.secret))}}function tr(e,r,n,t,i){return new Promise(o=>{let s,l=!1,f=h=>{if(!l){l=!0,clearTimeout(u);try{s?.close()}catch{}o(h)}},u=setTimeout(()=>f(null),i);try{s=new(r||globalThis.WebSocket)(e)}catch{return f(null)}s.onopen=()=>n(s),s.onmessage=h=>{try{let g=JSON.parse(h.data),a=t(g);a!==void 0&&f(a)}catch{}},s.onerror=()=>f(null),s.onclose=()=>f(null)})}async function Jr(e,r,{relays:n=nt,WebSocketImpl:t=null,timeout:i=8e3}={}){let o=await it(e),s=Wr(o,await _t(o,r));return(await Promise.all(n.map(f=>tr(f,t,u=>u.send(JSON.stringify(["EVENT",s])),u=>u[0]==="OK"&&u[1]===s.id?!!u[2]:void 0,i)))).filter(Boolean).length}async function Qr(e,{relays:r=nt,WebSocketImpl:n=null,timeout:t=6e3,settle:i=450}={}){let o=await it(e),s={kinds:[Ce],authors:[o.pubkey],"#d":[o.address],limit:1},l=u=>{if(!u||u.kind!==Ce||u.pubkey!==o.pubkey||!u.tags?.some(([g,a])=>g==="d"&&a===o.address))return!1;let h=Z(W(we.encode(JSON.stringify([0,u.pubkey,u.created_at,u.kind,u.tags,u.content]))));try{return h===u.id&&Le.verify(u.sig,u.id,u.pubkey)}catch{return!1}},f=await new Promise(u=>{let h=[],g=r.length,a=null,y=()=>{clearTimeout(a),u(h)},v=setTimeout(y,t);for(let O of r){let I=null;tr(O,n,q=>q.send(JSON.stringify(["REQ","sync",s])),q=>(q[0]==="EVENT"&&l(q[2])&&(!I||q[2].created_at>I.created_at)&&(I=q[2]),q[0]==="EOSE"||q[0]==="CLOSED"?I:void 0),t).then(q=>{q&&(h.push(q),a||(a=setTimeout(()=>{clearTimeout(v),y()},i))),--g===0&&(clearTimeout(v),y())})}});for(let u of f.sort((h,g)=>g.created_at-h.created_at))try{return await er(o,u.content)}catch{}return null}return ar(_r);})();

// Read-only Spotify web-client adapter. No cookie access, login or audio extraction.
// Request names/hashes describe Spotify's interface; see docs/spotify-helper.md.
const COMPANION_VERSION = '1.7.0';
const SPOTIFY_QUERY_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
const READ_QUERIES = Object.freeze({
  profileAttributes:'53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced',
  libraryV3:'390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455',
  fetchLibraryTracks:'087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240',
  fetchPlaylist:'cd2275433b29f7316176e7b5b5e098ae7744724e1a52d63549c76636b3257749',
  getTrack:'612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294',
});
const cleanText = (value, max=500) => typeof value==='string' ? value.slice(0,max) : '';
function spotifyId(value, type) {
  return typeof value==='string' ? value.match(new RegExp('^spotify:'+type+':([A-Za-z0-9]{22})$'))?.[1] || '' : '';
}
function spotifyCover(value) {
  try { const u=new URL(value); return u.protocol==='https:' && /(^|\.)(scdn\.co|spotifycdn\.com)$/.test(u.hostname) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
function spotifyProfileURL(id) {
  try { return id ? 'https://open.spotify.com/user/'+encodeURIComponent(cleanText(id,120)) : ''; } catch { return ''; }
}
function readSpotifyProfile(profile) {
  const id=cleanText(profile?.username,120);
  if(!id)return null;
  const sources=Array.isArray(profile.avatar?.sources)?profile.avatar.sources:[];
  const avatar=[...sources].sort((a,b)=>(Number(b?.width)||0)-(Number(a?.width)||0)).map(source=>spotifyCover(source?.url)).find(Boolean)||'';
  return {id,name:cleanText(profile.name,120)||id,avatar,externalUrl:spotifyProfileURL(id)};
}
function trackRecord(raw) {
  const wrapper=raw?.itemV2 || raw?.track || raw?.item;
  const data=wrapper && Object.hasOwn(wrapper,'data') ? wrapper.data : wrapper || raw;
  const uri=data?.uri ?? wrapper?._uri ?? wrapper?.uri ?? (data?.__typename==='Track' && /^[A-Za-z0-9]{22}$/.test(data.id||'')?'spotify:track:'+data.id:undefined);
  return {data,uri};
}
function trackArtists(t) {
  const names=items=>Array.isArray(items)?items.map(a=>cleanText(a?.profile?.name||a?.name).trim()).filter(Boolean):[];
  const full=names(Array.isArray(t?.artists)?t.artists:t?.artists?.items);
  return (full.length?full:[...new Set([...names(t?.firstArtist?.items),...names(t?.otherArtists?.items)])]).join(', ');
}
function unsupportedTrack(data,uri) {
  return ['LocalTrack','Episode','Podcast','Audiobook','RestrictedContent','NotFound'].includes(data?.__typename) || /^spotify:(local|episode|show|chapter|audiobook):/.test(uri||'');
}
function readSpotifyTrack(raw) {
  const {data:t,uri}=trackRecord(raw);
  const id=spotifyId(uri,'track');
  const artist=trackArtists(t),title=cleanText(t?.name).trim();
  if(!id || !title || !artist || unsupportedTrack(t,uri))return null;
  const cover=spotifyCover(t.albumOfTrack?.coverArt?.sources?.[0]?.url);
  const milliseconds=Number(t.duration?.totalMilliseconds??t.trackDuration?.totalMilliseconds??0);
  return {id:'spotify:'+id,spotifyId:id,provider:'spotify-import',title,artist:cleanText(artist),album:cleanText(t.albumOfTrack?.name),cover,coverXl:cover,duration:Number.isFinite(milliseconds)?Math.max(0,Math.min(86400,milliseconds/1000)):0,explicit:t.contentRating?.label==='EXPLICIT',externalUrl:'https://open.spotify.com/track/'+id};
}
function readSpotifyEntity(raw, type) {
  const t=raw?.item?.data || raw;
  const id=spotifyId(t?.uri ?? raw?.item?._uri ?? raw?.item?.uri,type);
  if(!id)return null;
  // Spotify can retain a URI in Your Library after the entity becomes unavailable.
  // Keep its identity so a previous local playlist copy can be preserved on refresh.
  if(type==='playlist' && t.__typename==='NotFound')return {id,type,title:'Unavailable playlist',cover:'',owner:'',status:'unavailable'};
  return {id,type,title:cleanText(t.name||t.profile?.name)||'Spotify '+type,cover:spotifyCover(t.coverArt?.sources?.[0]?.url||t.images?.items?.[0]?.sources?.[0]?.url||t.visuals?.avatarImage?.sources?.[0]?.url),owner:cleanText(t.ownerV2?.data?.name)};
}

function responseError(label,value) {
  // Only a bounded GraphQL type name is shown, never the raw response or credentials.
  const type=typeof value?.__typename==='string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.__typename)?' ('+value.__typename+')':'';
  return new Error('Could not read '+label+' from Spotify’s response'+type+'. Your saved library is kept.');
}
function playlistPage(result,playlist) {
  const value=result?.data?.playlistV2;
  if(value?.__typename==='NotFound' || value?.currentUserCapabilities?.canView===false){
    const error=new Error('Spotify could not return this playlist.');error.code='unavailable';throw error;
  }
  const label='playlist “'+playlist.title+'”';
  if(!value?.content)throw responseError(label,value);
  if(value.uri!=null && value.uri!=='spotify:playlist:'+playlist.id)throw new Error('Spotify returned a different playlist. Your saved library is kept.');
  return value.content;
}

function createTrackReader(query,signal,onProgress) {
  const repaired=new Map();let attempts=0,started=null,repairUnavailable=false;
  return async(items,label)=>{
    const tracks=[];let unreadable=0,skipped=0;
    for(const raw of items){
      signal?.throwIfAborted();
      let track=readSpotifyTrack(raw);
      const {data,uri}=trackRecord(raw);
      if(track){tracks.push(track);continue;}
      if(unsupportedTrack(data,uri) || data?.playability?.playable===false){skipped++;continue;}
      const id=spotifyId(uri,'track');
      // Repair only missing metadata, once per ID, with a bounded total cost.
      // A failed optional lookup never turns a partial collection into a complete one.
      if(id && !repaired.has(id) && !repairUnavailable && attempts<20 && (started===null || Date.now()-started<15000)){
        started??=Date.now();attempts++;
        onProgress('Checking missing song details in '+label+'…');
        try {
          const detail=(await query('getTrack',{uri:'spotify:track:'+id})).data?.trackUnion;
          track=readSpotifyTrack(detail);
          if(track?.spotifyId!==id)track=null;
          repaired.set(id,track);
        }catch(error){
          if(error.code!=='metadata-unavailable')throw error;
          repairUnavailable=true;repaired.set(id,null);
        }
      }
      signal?.throwIfAborted();
      track=id?repaired.get(id):null;
      if(track)tracks.push(track);else unreadable++;
    }
    return {tracks,unreadable,skipped};
  };
}

// A failed/truncated read never becomes a successful empty library.
async function readAllPages(getPage, {limit=50,max=10000,signal,label='library'}={}) {
  const result=[]; let expected=null; const seen=new Set();
  for(let offset=0;offset<=max;){
    signal?.throwIfAborted();
    const page=await getPage(offset,limit);
    if(!page || !Array.isArray(page.items) || !Number.isInteger(page.totalCount) || page.totalCount<0)throw responseError(label,page);
    if(page.totalCount>max)throw new Error('This collection is too large for a phone sync. Use the Spotify data export instead.');
    if(expected!==null && page.totalCount!==expected)throw new Error('The Spotify library changed during sync. Please try again.');
    expected=page.totalCount;
    if(page.pagingInfo?.offset!=null && page.pagingInfo.offset!==offset)throw new Error('Spotify returned the wrong page. Please try again.');
    if(!page.items.length && offset<expected)throw new Error('Spotify returned an incomplete collection. Your previous copy is kept.');
    const fingerprint=JSON.stringify(page.items);
    if(page.items.length && seen.has(fingerprint))throw new Error('Spotify repeated a page. Your previous copy is kept.');
    seen.add(fingerprint);result.push(...page.items);offset+=page.items.length;
    if(offset>=expected){if(offset!==expected)throw new Error('Spotify returned an inconsistent track count. Please retry.');return result;}
  }
  throw new Error('Spotify pagination did not finish.');
}

async function readSpotifyAccount(query,{signal,onProgress=()=>{}}={}) {
  onProgress('Reading your Spotify profile…');
  const profile=(await query('profileAttributes',{})).data?.me?.profile;
  if(!profile?.username || typeof profile.username!=='string')throw new Error('Sign in to Spotify, open Your Library, then try again.');
  const account=readSpotifyProfile(profile);
  const library={app:'spotplus-account',version:2,complete:true,account,capturedAt:Date.now(),likes:[],likesUnreadable:0,playlists:[],albums:[],artists:[],skipped:0};
  const readTracks=createTrackReader(query,signal,onProgress);
  const options={signal,max:10000};
  onProgress('Reading Liked Songs…');
  const liked=await readAllPages(async(offset,limit)=>{
    const page=(await query('fetchLibraryTracks',{offset,limit})).data?.me?.library;
    // Current responses wrap the page in tracks; retain the older direct-page shape.
    // An explicitly malformed tracks page must fail rather than fall back to an empty page.
    return page && Object.hasOwn(page,'tracks') ? page.tracks : page;
  },{...options,label:'Liked Songs'});
  const likedResult=await readTracks(liked,'Liked Songs');
  library.likes=likedResult.tracks;library.likesUnreadable=likedResult.unreadable;library.skipped+=likedResult.skipped;
  for(const [filter,key,type] of [['Playlists','playlists','playlist'],['Albums','albums','album'],['Artists','artists','artist']]){
    onProgress('Reading your '+filter.toLowerCase()+'…');
    const items=await readAllPages(async(offset,limit)=>(await query('libraryV3',{filters:[filter],order:null,textFilter:'',features:[],offset,limit,flatten:true,expandedFolders:[],folderUri:null,includeFoldersWhenFlattening:true})).data?.me?.libraryV3,{signal,max:1000,label:filter.toLowerCase()});
    library[key]=[...new Map(items.map(p=>readSpotifyEntity(p,type)).filter(Boolean).map(p=>[p.id,p])).values()];
  }
  let count=library.likes.length;
  for(const [index,p] of library.playlists.entries()){
    signal?.throwIfAborted();onProgress(`Reading playlist ${index+1} of ${library.playlists.length}: ${p.title}`);
    if(p.status==='unavailable'){p.tracks=[];continue;}
    try {
      const items=await readAllPages(async(offset,limit)=>playlistPage(await query('fetchPlaylist',{uri:'spotify:playlist:'+p.id,offset,limit,enableWatchFeedEntrypoint:false}),p),{...options,label:'playlist “'+p.title+'”'});
      const result=await readTracks(items,'playlist “'+p.title+'”');
      p.tracks=result.tracks;p.unreadable=result.unreadable;p.status=result.unreadable?'partial':'ready';library.skipped+=result.skipped;
      count+=p.tracks.length;if(count>20000)throw new Error('Your library exceeds this phone connector’s 20,000-track limit. Use the data export instead.');
    } catch(e) {
      // Only an explicitly inaccessible playlist can be omitted. Network/schema/rate failures abort sync.
      if(e.code!=='unavailable')throw e;
      p.tracks=[];p.status='unavailable';
    }
  }
  // Catch account switches during a long read.
  const end=(await query('profileAttributes',{})).data?.me?.profile?.username;
  if(end!==account.id)throw new Error('The Spotify account changed during sync. Please start again.');
  return library;
}

// Listening stats, the same data Stats for Spotify shows: top tracks/artists for
// Spotify's three windows and the last 50 plays. Read with the web player's own
// session from api.spotify.com (GET only, allowlisted paths). Optional: a failure here
// never blocks the library read.
const STATS_RANGES = Object.freeze(['short_term','medium_term','long_term']);
const STATS_PATHS = Object.freeze({
  tracks: range => '/v1/me/top/tracks?time_range='+range+'&limit=50',
  artists: range => '/v1/me/top/artists?time_range='+range+'&limit=50',
  recent: () => '/v1/me/player/recently-played?limit=50',
});
const webArtistNames = artists => Array.isArray(artists) ? artists.map(a => cleanText(a?.name, 200)).filter(Boolean).join(', ') : '';
const webImage = images => Array.isArray(images) ? spotifyCover(images.find(i => i?.url)?.url) : '';
function readWebTrack(t) {
  const id = typeof t?.id === 'string' && /^[A-Za-z0-9]{22}$/.test(t.id) ? t.id : '';
  const title = cleanText(t?.name, 300), artist = webArtistNames(t?.artists);
  if (!id || !title || !artist) return null;
  return {spotifyId: id, title, artist, album: cleanText(t.album?.name, 300), cover: webImage(t.album?.images), duration: Number.isFinite(t.duration_ms) ? Math.round(t.duration_ms / 1000) : 0};
}
function readWebArtist(a) {
  const id = typeof a?.id === 'string' && /^[A-Za-z0-9]{22}$/.test(a.id) ? a.id : '';
  const name = cleanText(a?.name, 200);
  if (!id || !name) return null;
  return {id, name, cover: webImage(a.images), genres: Array.isArray(a.genres) ? a.genres.map(g => cleanText(g, 60)).filter(Boolean).slice(0, 8) : []};
}
async function readSpotifyStats(get, {onProgress = () => {}} = {}) {
  const stats = {capturedAt: Date.now(), top: {}, recent: []};
  for (const range of STATS_RANGES) {
    onProgress('Reading your top music (' + {short_term: '4 weeks', medium_term: '6 months', long_term: 'all time'}[range] + ')…');
    const [tracks, artists] = [await get(STATS_PATHS.tracks(range)), await get(STATS_PATHS.artists(range))];
    if (!Array.isArray(tracks?.items) || !Array.isArray(artists?.items)) throw new Error('Spotify returned unexpected top-music data.');
    stats.top[range] = {tracks: tracks.items.map(readWebTrack).filter(Boolean), artists: artists.items.map(readWebArtist).filter(Boolean)};
  }
  const recent = await get(STATS_PATHS.recent());
  if (!Array.isArray(recent?.items)) throw new Error('Spotify returned unexpected recently-played data.');
  stats.recent = recent.items.map(item => {
    const track = readWebTrack(item?.track), at = Date.parse(item?.played_at);
    return track && Number.isFinite(at) ? {...track, playedAt: at} : null;
  }).filter(Boolean);
  return stats;
}

// Auto-read is scoped to an explicit, fresh Connect Spotify launch.
function canAutoRead({bridge,hostReady,authorization,attempted,now=Date.now()}){
 return !!hostReady&&!attempted&&!!bridge&&/^[a-f0-9]{32}$/.test(bridge.nonce||'')&&now>=bridge.started&&now-bridge.started<1800000&&['https://coye2.github.io'].includes(bridge.origin)&&/^Bearer\s+\S+$/.test(authorization||'');
}

// Clipboard handoff: Safari and an iPhone Home Screen app keep separate storage and
// cannot message each other, but they share the system clipboard. The library is
// gzip-compressed and base64-encoded behind a fixed prefix. Metadata only.
const LIBRARY_TEXT_PREFIX = 'SPOTPLUS-LIBRARY-1:';
const LIBRARY_TEXT_LIMIT = 12 * 1024 * 1024;
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
async function encodeLibraryText(library) {
  const json = JSON.stringify(library);
  if (typeof CompressionStream !== 'function') return LIBRARY_TEXT_PREFIX + 'json:' + json;
  const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return LIBRARY_TEXT_PREFIX + 'gz:' + toBase64(gz);
}
function isLibraryText(value) { return typeof value === 'string' && value.trim().startsWith(LIBRARY_TEXT_PREFIX); }
async function decodeLibraryText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text.startsWith(LIBRARY_TEXT_PREFIX)) throw new Error('No Spot+ library found. On Spotify, tap Copy for Spot+ first.');
  let body = text.slice(LIBRARY_TEXT_PREFIX.length);
  if (body.startsWith('gz:')) body = body.replace(/\s+/g, ''); // Base64 may pick up line breaks when pasted.
  const bad = () => new Error('The copied library is incomplete. On Spotify, tap Copy for Spot+ again.');
  let json;
  if (body.startsWith('json:')) json = body.slice(5);
  else if (body.startsWith('gz:')) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open copied libraries. Use Save library file instead.');
    if (body.length > LIBRARY_TEXT_LIMIT * 2) throw new Error('The copied library is larger than the 12 MB limit.');
    let bytes;
    try { const raw = atob(body.slice(3)); bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); } catch { throw bad(); }
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const {done, value: chunk} = await reader.read();
        if (done) break;
        size += chunk.length; chunks.push(chunk);
        if (size > LIBRARY_TEXT_LIMIT) { reader.cancel().catch(() => {}); throw new Error('The copied library is larger than the 12 MB limit.'); }
      }
    } catch (error) { if (/12 MB/.test(error.message)) throw error; throw bad(); }
    const all = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
    json = new TextDecoder().decode(all);
  } else throw bad();
  if (json.length > LIBRARY_TEXT_LIMIT) throw new Error('The copied library is larger than the 12 MB limit.');
  try { return JSON.parse(json); } catch { throw bad(); }
}

// Bundled with spotify-reader.js by build-companion.mjs. Runs only on open.spotify.com.
/* global READ_QUERIES, SPOTIFY_QUERY_URL, COMPANION_VERSION, readSpotifyAccount, canAutoRead, encodeLibraryText, readSpotifyStats, readSpotifyProfile, SpotPlusSync */
function runSpotifyCompanion(){
  if(location.origin!=='https://open.spotify.com'||document.getElementById('spotplus-companion'))return;
  const permittedOrigins=['https://coye2.github.io'];
  let targetOrigin=permittedOrigins[0];
  const originalFetch=window.fetch.bind(window), credentials={};
  const observedQueries=new Map();
  const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  let libraryText=null,controller=null,library=null,host=null,bridge=null,receiver=null,autoAttempted=false,autoTimer,attemptedAuth=null,allowAuthRetry=false,autoCancelled=false;
  try {
    const params=new URL(location.href).searchParams;
    const nonce=params.get('spotplus_bridge');
    const requestedOrigin=params.get('spotplus_origin');
    if(permittedOrigins.includes(requestedOrigin))targetOrigin=requestedOrigin;
    if(/^[a-f0-9]{32}$/.test(nonce||''))sessionStorage.setItem('spotplus.bridge',JSON.stringify({nonce,origin:targetOrigin,started:Date.now()}));
    const saved=JSON.parse(sessionStorage.getItem('spotplus.bridge')||'null');
    if(saved&&Date.now()-saved.started<30*60*1000&&/^[a-f0-9]{32}$/.test(saved.nonce)){bridge=saved;if(permittedOrigins.includes(saved.origin))targetOrigin=saved.origin;}
  }catch{ /* Safari can disable storage in a restricted session. File handoff still works. */ }
  // Auto-sync: Spot+ hands over a link key once, in the URL #fragment (never sent to
  // Spotify's servers). From then on, any visit to Spotify's website quietly publishes
  // your top music and recent plays (encrypted) for Spot+ to pick up, every 30 minutes.
  let syncKey=null,syncing=false;
  try{
    const linked=location.hash.match(/spotplus_sync=([a-f0-9]{64})/);
    if(linked){localStorage.setItem('spotplus.syncKey',linked[1]);history.replaceState(history.state,'',location.pathname+location.search);}
    syncKey=localStorage.getItem('spotplus.syncKey');
  }catch{ /* Storage disabled: auto-sync stays off. */ }
  const allowedHeaders=['authorization','client-token','spotify-app-version','app-platform'];
  function rememberBody(body){
    try {
      const value=typeof body==='string'?JSON.parse(body):body;
      const hash=value?.extensions?.persistedQuery?.sha256Hash;
      if(Object.hasOwn(READ_QUERIES,value?.operationName)&&/^[a-f0-9]{64}$/.test(hash))observedQueries.set(value.operationName,{hash,variables:value.variables||{}});
    }catch{ /* Unrelated Spotify request. */ }
  }
  function rememberHeaders(headers){
    try {const h=new Headers(headers);for(const name of allowedHeaders)if(h.has(name))credentials[name]=h.get(name);}catch{ /* Preserve Spotify's request even if it has unusual headers. */ }
    maybeAutoRead();
  }
  function isQuery(value){try {const u=new URL(value,location.origin);return u.origin==='https://api-partner.spotify.com'&&/^\/pathfinder\/v[12]\/query$/.test(u.pathname);}catch{return false;}}
  // Observe only Spotify's own query requests. Never read document.cookie or save credentials.
  window.fetch=function(input,init){
    try {
      const url=typeof input==='string'||input instanceof URL?String(input):input.url;
      if(isQuery(url)){
        rememberHeaders(init?.headers||input?.headers);
        const u=new URL(url);if(u.searchParams.has('operationName'))rememberBody({operationName:u.searchParams.get('operationName'),variables:JSON.parse(u.searchParams.get('variables')||'{}'),extensions:JSON.parse(u.searchParams.get('extensions')||'{}')});
        if(init?.body)rememberBody(init.body);else if(input instanceof Request&&input.method==='POST')input.clone().text().then(rememberBody).catch(()=>{});
      }
    }catch{ /* Observation must never interrupt Spotify. */ }
    return originalFetch(input,init);
  };
  const xhrRequests=new WeakMap(),xhrOpen=XMLHttpRequest.prototype.open,xhrHeader=XMLHttpRequest.prototype.setRequestHeader,xhrSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest){xhrRequests.set(this,{query:isQuery(url)});return xhrOpen.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.setRequestHeader=function(name,value){if(xhrRequests.get(this)?.query&&allowedHeaders.includes(String(name).toLowerCase()))credentials[String(name).toLowerCase()]=String(value);return xhrHeader.call(this,name,value);};
  XMLHttpRequest.prototype.send=function(body){if(xhrRequests.get(this)?.query){rememberBody(body);maybeAutoRead();}return xhrSend.call(this,body);};
  function status(message){const p=host?.shadowRoot?.getElementById('status');if(p)p.textContent=message;}
  function notify(phase){if(bridge&&window.opener&&Date.now()-bridge.started<1800000)window.opener.postMessage({type:'spotplus-connection-status',nonce:bridge.nonce,phase},targetOrigin);}
  function controls(busy){for(const id of ['read','send','save']){const b=host?.shadowRoot?.getElementById(id);if(b)b.disabled=busy;}const cancel=host?.shadowRoot?.getElementById('cancel');if(cancel)cancel.hidden=!busy;}
  async function query(name,variables){
    if(!Object.hasOwn(READ_QUERIES,name))throw new Error('Only reading your music library is supported.');
    controller.signal.throwIfAborted();
    const known=observedQueries.get(name),headers={};
    for(const key of allowedHeaders)if(credentials[key])headers[key]=credentials[key];
    if(!/^Bearer\s+\S+$/.test(headers.authorization||''))throw new Error('Sign in to Spotify and open Your Library first. Then tap Read library. If needed, reload this Spotify tab after enabling the companion.');
    headers['content-type']='application/json';
    const body={operationName:name,variables:{...known?.variables,...variables},extensions:{persistedQuery:{version:1,sha256Hash:known?.hash||READ_QUERIES[name]}}};
    const timeout=new AbortController(),id=setTimeout(()=>timeout.abort(),name==='getTrack'?5000:30000);
    const abort=()=>timeout.abort();controller.signal.addEventListener('abort',abort,{once:true});
    try{
      const response=await originalFetch(SPOTIFY_QUERY_URL,{method:'POST',headers,body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:timeout.signal});
      if(response.status===401)throw new Error('Your Spotify session expired. Reload Spotify and sign in again.');
      if(response.status===429)throw new Error('Spotify is limiting requests. Wait '+(Math.max(1,Number(response.headers.get('retry-after'))||60))+' seconds before syncing again.');
      if(response.status===403)throw new Error('Spotify refused this request. Open the collection on Spotify and try again.');
      if(!response.ok)throw new Error('Spotify is temporarily unavailable ('+response.status+'). Your previous library is kept.');
      const result=await response.json();
      if(result.errors?.length){
        if(name==='getTrack'){const error=new Error('Spotify could not supply the missing song details.');error.code='metadata-unavailable';throw error;}
        if(name==='fetchPlaylist'&&result.errors.every(e=>['NOT_FOUND','PERMISSION_DENIED'].includes(e.extensions?.code))){const error=new Error('Playlist unavailable');error.code='unavailable';throw error;}
        throw new Error('Spotify’s web interface changed or this collection is unavailable. Open Liked Songs and a playlist on Spotify, then try again. Your saved library is kept.');
      }
      return result;
    }catch(error){
      if(error.name==='AbortError'){
        const failure=new Error(controller.signal.aborted?'Sync cancelled. Your saved library is kept.':'Spotify took too long to respond. Try again.');
        if(name==='getTrack'&&!controller.signal.aborted)failure.code='metadata-unavailable';
        throw failure;
      }
      throw error;
    }
    finally{clearTimeout(id);controller.signal.removeEventListener('abort',abort);}
  }
  // GET-only access to the allowlisted listening-stats paths on Spotify's public Web API,
  // using the web player's own authorization. Nothing is written to the account.
  async function webGet(path){
    if(!/^\/v1\/me\/(top\/(tracks|artists)\?time_range=(short|medium|long)_term&limit=50|player\/recently-played\?limit=50)$/.test(path))throw new Error('Only reading listening stats is supported.');
    controller?.signal.throwIfAborted();
    if(!/^Bearer\s+\S+$/.test(credentials.authorization||''))throw new Error('Spotify session not ready.');
    const timeout=new AbortController(),id=setTimeout(()=>timeout.abort(),15000),abort=()=>timeout.abort();
    controller?.signal.addEventListener('abort',abort,{once:true});
    try{
      const response=await originalFetch('https://api.spotify.com'+path,{headers:{authorization:credentials.authorization,accept:'application/json'},credentials:'omit',cache:'no-store',redirect:'error',signal:timeout.signal});
      if(!response.ok){const error=new Error('Spotify stats unavailable ('+response.status+').');error.status=response.status;throw error;}
      return await response.json();
    }finally{clearTimeout(id);controller?.signal.removeEventListener('abort',abort);}
  }
  function syncNote(text){const p=host?.shadowRoot?.getElementById('sync');if(p)p.textContent=text;}
  async function publishStats(stats,account){
    if(!syncKey||!stats)return;
    const n=await SpotPlusSync.publishSnapshot(syncKey,{v:1,account,stats,at:Date.now()});
    if(!n)throw new Error('no relay reachable');
    try{localStorage.setItem('spotplus.syncAt',String(Date.now()));}catch{ /* Ignore. */ }
    syncNote('Auto-sync on · Spot+ updated just now');
  }
  async function autoSync(){
    if(!syncKey||syncing||controller||!/^Bearer\s+\S+$/.test(credentials.authorization||''))return;
    let last=0;try{last=Number(localStorage.getItem('spotplus.syncAt'))||0;}catch{ /* Ignore. */ }
    if(Date.now()-last<30*60*1000)return;
    syncing=true;controller=new AbortController();
    try{
      syncNote('Auto-sync · updating Spot+…');
      const stats=await readSpotifyStats(webGet);
      let account=null;try{account=readSpotifyProfile((await query('profileAttributes',{})).data?.me?.profile);}catch{ /* Stats still sync. */ }
      await publishStats(stats,account);
    }catch(error){syncNote('Auto-sync will retry later ('+String(error.message||error).slice(0,60)+')');}
    finally{syncing=false;controller=null;}
  }
  setInterval(autoSync,5*60*1000);
  function maybeAutoRead(){
    if(syncKey)setTimeout(autoSync,4000);
    if(!canAutoRead({bridge,hostReady:!!host,authorization:credentials.authorization,attempted:autoCancelled||(autoAttempted&&!(allowAuthRetry&&attemptedAuth!==credentials.authorization))}))return;
    autoAttempted=true;attemptedAuth=credentials.authorization;allowAuthRetry=false;status('Connected to Spotify. Reading your library…');autoTimer=setTimeout(()=>host?.shadowRoot?.getElementById('read')?.click(),600);
  }
  function sendLibrary(openReceiver=false){
    if(!library)return false;
    if(bridge&&window.opener&&Date.now()-bridge.started<1800000){
      window.opener.postMessage({type:'spotplus-library',nonce:bridge.nonce,library},targetOrigin);
      status('Sent for review. Return to Spot+ to apply your library. If nothing arrives, use Save library file.');
      if(!openReceiver)return true;
    }
    if(!openReceiver)return false;
    if(!bridge||Date.now()-bridge.started>=1800000)bridge={nonce:[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join(''),origin:targetOrigin,started:Date.now()};
    const base=targetOrigin===permittedOrigins[0]?targetOrigin+'/spot-plus/':targetOrigin+'/';
    receiver=window.open(base+'#/spotify-account/receive/'+bridge.nonce,'spotplus-library-return');
    status(receiver?'Spot+ opened for review. Keep this Spotify tab open until the transfer finishes.':'Your browser blocked the return tab. Choose Save library file, then import it in Spot+.');
    return !!receiver;
  }
  function mount(){
    if(!document.body)return;
    host=document.createElement('div');host.id='spotplus-companion';host.style.cssText='position:fixed;right:12px;bottom:88px;z-index:2147483647;max-width:calc(100vw - 24px)';
    const root=host.attachShadow({mode:'open'});
    root.innerHTML='<style>:host{color-scheme:dark}*{box-sizing:border-box}section{font:14px/1.45 system-ui,sans-serif;color:#fff;background:#090e0b;border:1px solid #315d49;border-radius:16px;padding:16px;width:330px;max-width:100%;box-shadow:0 8px 36px #000a}h2{font-size:18px;margin:0 0 8px}p{color:#c2c9c4;margin:8px 0}button,a{font:inherit;min-height:44px;border:1px solid #315d49;background:#15231b;color:#fff;border-radius:22px;padding:9px 14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;margin:4px 4px 0 0}button:first-of-type{background:#1b5e46}button:disabled{opacity:.5;cursor:wait}small{display:block;color:#abb6ae;margin-top:12px}#close{float:right;border:0;padding:4px;min-height:28px;margin:0;background:transparent}#cancel[hidden],#sync:empty{display:none}.sync-note{font-size:11px;opacity:.72;margin:6px 0 0}#copy[hidden],#send[hidden],#save[hidden]{display:none}#copy{background:#1db954;color:#000;font-weight:700;width:100%;justify-content:center;min-height:52px}#read[hidden]{display:none}#save{border:0;background:transparent;color:#abb6ae;text-decoration:underline}</style><section aria-label="Spot+ Spotify companion"><button id="close" aria-label="Minimize companion">−</button><h2>Spot+ companion · Beta</h2><div id="body"><p>Read your signed-in Spotify library. No Premium or developer account needed.</p><p id="status" role="status" aria-live="polite">Sign in and open Your Library, then tap Read library.</p><p id="sync" class="sync-note"></p><button id="read">Read library</button><button id="cancel" hidden>Cancel</button><button id="copy" hidden>Copy for Spot+</button><button id="send" hidden>Send to Spot+</button><button id="save" hidden>Save library file</button><small>Reads Liked Songs, playlists, saved albums and followed artists. Only your profile and music details leave this page. Spotify cookies and session tokens stay here.</small></div></section>';
    document.body.append(host);
    const version=document.createElement('small');version.textContent='Helper '+COMPANION_VERSION;root.querySelector('h2').append(version);
    root.getElementById('close').onclick=()=>{const body=root.getElementById('body');body.hidden=!body.hidden;root.getElementById('close').textContent=body.hidden?'+':'−';};
    root.getElementById('cancel').onclick=()=>{clearTimeout(autoTimer);autoAttempted=true;autoCancelled=true;controller?.abort();};
    root.getElementById('read').onclick=async()=>{
      clearTimeout(autoTimer);autoAttempted=true;if(controller&&!controller.signal.aborted&&root.getElementById('read').disabled)return;
      library=null;libraryText=null;controller=new AbortController();controls(true);for(const id of ['copy','send','save'])root.getElementById(id).hidden=true;
      notify('reading');
      try{
        library=await readSpotifyAccount(query,{signal:controller.signal,onProgress:status});
        // Listening stats ride along automatically. Optional: the library still sends if they fail.
        try{library.stats=await readSpotifyStats(webGet,{onProgress:status});publishStats(library.stats,library.account).catch(()=>{});}
        catch(error){if(controller.signal.aborted)throw error;library.stats=null;library.statsError=String(error.message||'Stats unavailable').slice(0,200);}
        if(JSON.stringify(library).length>12*1024*1024)throw new Error('Your library exceeds the 12 MB phone transfer limit. Use Spotify’s data export.');
        const unavailable=library.playlists.filter(p=>p.status==='unavailable').length;
        const unreadable=library.likesUnreadable+library.playlists.reduce((n,p)=>n+(p.unreadable||0),0);
        status('Ready for review: '+library.likes.length+' liked songs, '+library.playlists.length+' playlists'+(library.stats?', your top music and recent plays.':'.')+(unavailable?' '+unavailable+' unavailable; any saved copies will be kept.':'')+(unreadable?' Song entries with incomplete details: '+unreadable+'. Existing copies of affected collections will be kept; new collections contain the readable songs.':'')+(isIOS?' Tap Copy for Spot+, then open Spot+ and tap Paste from Spotify.':' Review and send your library to Spot+.'));
        encodeLibraryText(library).then(text=>{libraryText=text;},()=>{libraryText=null;});
        // iPhone without a Spot+ tab to message: Copy is the one button that matters.
        const pasteOnly=isIOS&&!window.opener;
        root.getElementById('copy').hidden=false;root.getElementById('send').hidden=pasteOnly;root.getElementById('save').hidden=false;
        if(pasteOnly){root.getElementById('read').hidden=true;status('Ready: '+library.likes.length+' liked songs, '+library.playlists.length+' playlists. Tap Copy for Spot+, then go back to Spot+.');}
        notify('done');
        if(sendLibrary()&&isIOS)status('Sent! Switch back to the Spot+ tab to apply your library.');
      }catch(error){library=null;allowAuthRetry=/sign in|session expired/i.test(error.message||'');status(error.message||'Sync could not complete. Your previous library is kept.');notify('error');}
      finally{controls(false);}
    };
    root.getElementById('send').onclick=()=>sendLibrary(true);
    // The clipboard is shared by Safari and the iPhone Home Screen app, so this works
    // where tab messaging cannot. Every path below starts synchronously inside the tap.
    const copied=()=>{status('Copied ✓ Now go back to Spot+ — it will offer to paste. Nothing was sent anywhere else.');root.getElementById('copy').textContent='Copied ✓';};
    const copyFailed=error=>status('Copy failed'+(error?.name?' ('+error.name+')':'')+'. Tap Copy for Spot+ again, or Save library file.');
    function legacyCopy(text){
      // execCommand works on iOS Safari within a tap, even where the async API refuses.
      const field=document.createElement('textarea');field.value=text;field.readOnly=true;
      field.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
      root.append(field);field.focus();field.setSelectionRange(0,text.length);
      let ok=false;try{ok=document.execCommand('copy');}catch{ok=false;}field.remove();return ok;
    }
    root.getElementById('copy').onclick=()=>{
      if(!library)return;
      const clip=navigator.clipboard;
      if(libraryText){
        if(clip?.writeText)clip.writeText(libraryText).then(copied,error=>legacyCopy(libraryText)?copied():copyFailed(error));
        else if(legacyCopy(libraryText))copied();else copyFailed();
        return;
      }
      // Not encoded yet: Safari accepts a promised ClipboardItem inside the tap.
      if(clip?.write&&typeof ClipboardItem==='function'){
        const blob=encodeLibraryText(library).then(text=>{libraryText=text;return new Blob([text],{type:'text/plain'});});
        clip.write([new ClipboardItem({'text/plain':blob})]).then(copied,copyFailed);
      }else status('Preparing your library… tap Copy for Spot+ again in a moment.');
    };
    root.getElementById('save').onclick=()=>{
      if(!library)return;
      const name='spotplus-spotify-library.json',json=JSON.stringify(library);
      // iPhone: the share sheet's Save to Files is the reliable way to keep a file.
      try{
        const file=new File([json],name,{type:'application/json'});
        if(isIOS&&navigator.canShare?.({files:[file]})){
          navigator.share({files:[file]}).then(()=>status('Saved. In Spot+, choose Import library file and pick '+name+'.'),error=>{if(error?.name!=='AbortError')status('Sharing failed. Try Copy for Spot+ instead.');});
          return;
        }
      }catch{ /* Fall back to a normal download. */ }
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';a.style.display='none';
      root.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status('Downloaded '+name+'. In Spot+, choose Import library file.');
    };
    // Spotify's mobile site handles touches at the document level, which can cancel
    // the synthetic click on iOS. Run each button on touchend and keep panel events
    // away from Spotify's listeners.
    for(const type of ['touchstart','touchend','pointerdown','pointerup','mousedown','mouseup','click'])host.addEventListener(type,event=>event.stopPropagation());
    for(const button of root.querySelectorAll('button')){
      let start=null;
      button.addEventListener('touchstart',event=>{const t=event.touches[0];start=t&&{x:t.clientX,y:t.clientY};},{passive:true});
      button.addEventListener('touchend',event=>{
        const t=event.changedTouches[0];
        if(!start||!t||Math.abs(t.clientX-start.x)>10||Math.abs(t.clientY-start.y)>10||button.disabled||button.hidden)return;
        start=null;event.preventDefault();button.onclick?.(event);
      },{passive:false});
    }
    maybeAutoRead();
    notify('ready');
    window.addEventListener('message',event=>{
      if(!bridge||Date.now()-bridge.started>=1800000||event.origin!==targetOrigin||event.data?.nonce!==bridge.nonce)return;
      if(event.data.type==='spotplus-receiver-ready'&&event.source===receiver&&library)receiver.postMessage({type:'spotplus-library',nonce:bridge.nonce,library},targetOrigin);
      if(event.data.type==='spotplus-library-applied'&&(event.source===window.opener||event.source===receiver)){
        status('Your library is now saved in Spot+. You can close this Spotify tab.');
        if(/^[a-f0-9]{64}$/.test(event.data.syncKey||'')){syncKey=event.data.syncKey;try{localStorage.setItem('spotplus.syncKey',syncKey);}catch{ /* Ignore. */ }publishStats(library?.stats,library?.account).catch(()=>{});}
      }
    });
  }
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
}

runSpotifyCompanion();
})();