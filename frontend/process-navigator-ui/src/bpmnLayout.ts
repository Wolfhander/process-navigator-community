export type LayoutNode = { id: string; x: number; width: number };

/** Group nodes already near the same x-coordinate, then leave enough room for each column. */
export function planHorizontalColumns(nodes: LayoutNode[], gap = 70): Map<string, number> {
  const result = new Map<string, number>();
  if (nodes.length === 0) return result;
  const ordered = [...nodes].sort((left, right) => left.x - right.x);
  const columns: LayoutNode[][] = [];
  for (const node of ordered) {
    const column = columns.at(-1);
    if (!column || node.x - column[0].x > 95) columns.push([node]);
    else column.push(node);
  }
  let targetX = ordered[0].x;
  for (const column of columns) {
    for (const node of column) result.set(node.id, targetX);
    targetX += Math.max(...column.map(node => node.width)) + gap;
  }
  return result;
}
