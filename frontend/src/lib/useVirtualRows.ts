import { useLayoutEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

/** Lists up to this long render every row, exactly as before. */
const VIRTUALIZE_AFTER = 150;

/**
 * Window-scrolled virtualisation for long lists (the admin pages scroll the window, not a
 * container): only the items near the viewport are rendered, and spacers stand in for the
 * rest. Items are measured after render, so variable heights are fine.
 *
 * Put `listRef` on the element that holds the items (a <tbody> or a <div>), render
 * `items` (each with `ref={measureRef}` and `data-index={item.index}`), and render
 * `paddingTop` / `paddingBottom` spacers around them. When `enabled` is false, render
 * every item as usual.
 */
export function useVirtualRows<T extends HTMLElement>(
  count: number,
  estimateSize: (index: number) => number,
  getItemKey?: (index: number) => string | number
) {
  const listRef = useRef<T>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const enabled = count > VIRTUALIZE_AFTER;

  // Where the list starts on the page; content above it (filters, banners) can move it,
  // so re-check after every render. Updating only on a real change stops the loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs after every render on purpose
  useLayoutEffect(() => {
    if (!enabled || !listRef.current) return;
    const top = listRef.current.getBoundingClientRect().top + window.scrollY;
    if (Math.abs(top - scrollMargin) > 1) setScrollMargin(top);
  });

  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize,
    getItemKey,
    overscan: 10,
    scrollMargin,
    enabled,
  });

  const items = enabled ? virtualizer.getVirtualItems() : [];
  const paddingTop = items.length ? items[0].start - scrollMargin : 0;
  const paddingBottom = items.length
    ? Math.max(0, virtualizer.getTotalSize() - (items[items.length - 1].end - scrollMargin))
    : 0;

  return { enabled, listRef, items, paddingTop, paddingBottom, measureRef: virtualizer.measureElement };
}
