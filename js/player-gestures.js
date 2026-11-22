export function shouldDismissPlayer(dx, dy, elapsed, height) {
  return dy > Math.abs(dx) * 1.2 && (dy > Math.max(80, Math.min(130, height * 0.13)) || (dy > 40 && dy / Math.max(1, elapsed) > 0.7));
}

export function shouldSkipTrack(dx, dy, elapsed, width = 360) {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX <= absY * 1.4) return null;
  const distThreshold = Math.max(56, Math.min(110, width * 0.16));
  const flick = absX > 34 && absX / Math.max(1, elapsed) > 0.55;
  if (absX < distThreshold && !flick) return null;
  return dx < 0 ? 'next' : 'prev';
}

export function bindPlayerDismiss(element, close, { onNext, onPrev } = {}) {
  if (!element) return;
  let drag = null, timer = 0, swipeTimer = 0;
  element.addEventListener('dragstart', (event) => {
    if (event.target.closest('.np-art')) event.preventDefault();
  });
  const reset = () => {
    element.style.transform = '';
    element.style.transition = '';
    delete element.dataset.dragging;
  };
  const resetArt = (art) => {
    if (!art) return;
    art.style.transform = '';
    art.style.transition = '';
  };

  element.addEventListener('pointerdown', (event) => {
    if (element.hidden || !matchMedia('(max-width:767px), (max-width:950px) and (max-height:500px) and (orientation:landscape)').matches || event.button > 0 || event.target.closest('button,input,a,select')) return;
    const inTop = !!event.target.closest('.np-top');
    const artEl = element.dataset.mode === 'art' ? event.target.closest('.np-art') : null;
    const inBody = element.dataset.mode === 'art' && !!event.target.closest('.np-body');
    if (!inTop && !inBody) return;
    clearTimeout(timer);
    clearTimeout(swipeTimer);
    reset();
    if (artEl) resetArt(artEl);
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      dx: 0,
      dy: 0,
      axis: null,
      art: (artEl && (onNext || onPrev)) ? artEl : null,
    };
  });

  element.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.dx = event.clientX - drag.x;
    drag.dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(drag.dx) > 12 && Math.abs(drag.dx) > Math.abs(drag.dy) * 1.25) {
        if (drag.art) {
          drag.axis = 'x';
          element.setPointerCapture?.(event.pointerId);
        } else {
          drag = null;
          return;
        }
      } else if (drag.dy > 8 && drag.dy > Math.abs(drag.dx)) {
        drag.axis = 'y';
        element.setPointerCapture?.(event.pointerId);
        element.dataset.dragging = 'true';
      } else {
        return;
      }
    }
    if (event.cancelable) event.preventDefault();
    if (drag.axis === 'y') {
      const clampedY = Math.max(0, drag.dy);
      element.style.transform = `translate3d(0,${clampedY}px,0)`;
    } else if (drag.axis === 'x' && drag.art) {
      const clampedX = Math.max(-96, Math.min(96, drag.dx * 0.55));
      drag.art.style.transition = 'none';
      drag.art.style.transform = `translate3d(${clampedX}px,0,0)`;
    }
  }, { passive: false });

  const end = (event, cancelled = false) => {
    if (!drag || drag.id !== event.pointerId) return;
    const current = drag;
    drag = null;
    delete element.dataset.dragging;
    const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches || document.body.dataset.motion === 'reduced';
    const elapsed = performance.now() - current.time;

    if (current.axis === 'x' && current.art) {
      const dir = !cancelled ? shouldSkipTrack(current.dx, current.dy, elapsed, current.art.clientWidth || element.clientWidth || 360) : null;
      current.art.style.transition = reduced ? 'none' : 'transform 200ms cubic-bezier(.2,.8,.2,1)';
      current.art.style.transform = '';
      swipeTimer = setTimeout(() => resetArt(current.art), reduced ? 0 : 200);
      if (dir === 'next' && onNext) onNext();
      else if (dir === 'prev' && onPrev) onPrev();
      return;
    }

    if (current.axis === 'y') {
      const dismiss = !cancelled && shouldDismissPlayer(current.dx, Math.max(0, current.dy), elapsed, element.clientHeight);
      element.style.transition = reduced ? 'none' : 'transform 220ms cubic-bezier(.2,.8,.2,1)';
      element.style.transform = dismiss ? 'translate3d(0,100%,0)' : '';
      timer = setTimeout(() => {
        if (dismiss) close();
        reset();
      }, reduced ? 0 : 220);
    }
  };

  element.addEventListener('pointerup', (event) => end(event));
  element.addEventListener('pointercancel', (event) => end(event, true));
}
