import { useCallback, useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 8;

// Recognizes a horizontal pointer drag distinct from a tap, so a swipe-to-pan
// gesture on a chart doesn't fight recharts' own tap/hover tooltip handling.
// Past the threshold it reports incremental pixel deltas via onPanBy; the
// caller converts those into whatever unit it panning (e.g. milliseconds of
// a time-based x-axis) and can use isDragging to suppress hover UI meanwhile.
function useHorizontalPan({ onPanBy, disabled = false } = {}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);

  const onPointerDown = useCallback((e) => {
    if (disabled) return;
    dragRef.current = { startX: e.clientX, lastX: e.clientX, pointerId: e.pointerId, dragging: false };
  }, [disabled]);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || disabled) return;
    if (!drag.dragging) {
      if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      setIsDragging(true);
      try {
        e.target.setPointerCapture(drag.pointerId);
      } catch (_) {
        // Some pointer sources (e.g. simulated events) don't support capture.
      }
    }
    const dx = e.clientX - drag.lastX;
    drag.lastX = e.clientX;
    onPanBy(dx);
  }, [disabled, onPanBy]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  return {
    isDragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave: endDrag,
    },
  };
}

export default useHorizontalPan;
