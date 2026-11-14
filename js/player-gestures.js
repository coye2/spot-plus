export function shouldDismissPlayer(dx,dy,elapsed,height){return dy>Math.abs(dx)*1.2&&(dy>Math.max(80,Math.min(130,height*.13))||(dy>40&&dy/Math.max(1,elapsed)>.7));}
export function bindPlayerDismiss(element,close){
 let drag=null,timer;
 element.addEventListener('dragstart',event=>{if(event.target.closest('.np-art'))event.preventDefault();});
 const reset=()=>{element.style.transform='';element.style.transition='';delete element.dataset.dragging;};
 element.addEventListener('pointerdown',event=>{
  if(element.hidden||!matchMedia('(max-width:767px), (max-width:950px) and (max-height:500px) and (orientation:landscape)').matches||event.button>0||event.target.closest('button,input,a,select'))return;
  if(!event.target.closest('.np-top')&&!(element.dataset.mode==='art'&&event.target.closest('.np-body')))return;
  clearTimeout(timer);reset();drag={id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now(),dx:0,dy:0,moving:false};
 });
 element.addEventListener('pointermove',event=>{
  if(!drag||drag.id!==event.pointerId)return;drag.dx=event.clientX-drag.x;drag.dy=Math.max(0,event.clientY-drag.y);
  if(!drag.moving&&Math.abs(drag.dx)>12&&Math.abs(drag.dx)>drag.dy){drag=null;return;}
  if(drag.dy<8&&!drag.moving)return;
  drag.moving=true;element.setPointerCapture?.(event.pointerId);element.dataset.dragging='true';if(event.cancelable)event.preventDefault();element.style.transform=`translate3d(0,${drag.dy}px,0)`;
 },{passive:false});
 const end=(event,cancelled=false)=>{
  if(!drag||drag.id!==event.pointerId)return;const current=drag;drag=null;delete element.dataset.dragging;
  const dismiss=!cancelled&&shouldDismissPlayer(current.dx,current.dy,performance.now()-current.time,element.clientHeight);
  const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches||document.body.dataset.motion==='reduced';
  element.style.transition=reduced?'none':'transform 220ms cubic-bezier(.2,.8,.2,1)';element.style.transform=dismiss?'translate3d(0,100%,0)':'';
  timer=setTimeout(()=>{if(dismiss)close();reset();},reduced?0:220);
 };
 element.addEventListener('pointerup',event=>end(event));element.addEventListener('pointercancel',event=>end(event,true));
}
