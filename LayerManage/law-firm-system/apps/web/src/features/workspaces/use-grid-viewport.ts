import { useCallback, useState } from 'react';

/** Virtual rows need a numeric viewport, not a fixed height or a CSS-only cap. */
export function useGridViewport() {
  const [bodyHeight, setBodyHeight] = useState(120);
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    let header: Element | null = null;
    const measure = () => {
      // Leave room for the virtual table's horizontal scrollbar and borders.
      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      const height = Math.max(1, Math.floor(node.clientHeight - headerHeight - 16));
      setBodyHeight(previous => previous === height ? previous : height);
    };
    const resize = new ResizeObserver(measure);
    const observeHeader = () => {
      const next = node.querySelector('.ant-table-header');
      if (next === header) return;
      if (header) resize.unobserve(header);
      header = next;
      if (header) resize.observe(header);
      measure();
    };
    resize.observe(node);
    observeHeader();
    // Empty/populated tables can replace the header without resizing the pane.
    const changes = new MutationObserver(observeHeader);
    changes.observe(node, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      changes.disconnect();
    };
  }, []);
  return { gridRef, bodyHeight };
}
