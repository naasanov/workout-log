import { useCallback, useRef, useState } from 'react';

export type QueuedPart = Record<string, unknown>;

export interface QueuedMessage {
  id: number;
  text: string;
  /** Attachment parts captured when the message was queued. */
  attachments: QueuedPart[];
}

export interface MergedQueue {
  text: string;
  attachments: QueuedPart[];
}

/** Joins queued messages into one: texts on separate lines, attachments in queue order. */
export function mergeQueued(items: QueuedMessage[]): MergedQueue {
  return {
    text: items.map(i => i.text).filter(Boolean).join('\n'),
    attachments: items.flatMap(i => i.attachments),
  };
}

/**
 * Messages typed while a reply streams. A ref mirrors the state so `take`
 * drains synchronously and an effect re-running cannot send the same items twice.
 */
export function useMessageQueue() {
  const [items, setItems] = useState<QueuedMessage[]>([]);
  const itemsRef = useRef<QueuedMessage[]>([]);
  const nextIdRef = useRef(1);

  const enqueue = useCallback((text: string, attachments: QueuedPart[]) => {
    const next = [...itemsRef.current, { id: nextIdRef.current++, text, attachments }];
    itemsRef.current = next;
    setItems(next);
  }, []);

  const remove = useCallback((id: number) => {
    const next = itemsRef.current.filter(i => i.id !== id);
    itemsRef.current = next;
    setItems(next);
  }, []);

  const take = useCallback((): QueuedMessage[] => {
    const taken = itemsRef.current;
    if (taken.length === 0) return taken;
    itemsRef.current = [];
    setItems([]);
    return taken;
  }, []);

  return { items, enqueue, remove, take, clear: take };
}
