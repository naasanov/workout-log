import { useCallback, useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 8;

// Tells a horizontal drag apart from a tap so panning a chart doesn't fight its
// tooltip. Past the threshold it reports pixel deltas via onPanBy, and
// isDragging lets the caller hide hover UI meanwhile.
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
