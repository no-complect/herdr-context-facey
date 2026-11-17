// Source: src/visibility.ts. Run npm run build to update the runtime JavaScript.
// Return null when the copy is outside the layout tree (for example, a pane).
export function layoutVisibility(root: unknown, mod: string, blockId?: string) {
  let found = false,
    visible = false;
  function visit(value: unknown, parentVisible: boolean) {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const shown = parentVisible && node.hidden !== true;
    const content = node.content as { mod?: unknown } | null | undefined;
    if (content?.mod === mod && (!blockId || node.id === blockId)) {
      found = true;
      visible ||= shown;
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      const id: unknown = child?.id;
      visit(child, shown && (node.type !== "stack" || !node.active || id === node.active));
    }
  }
  visit(root, true);
  return found ? visible : null;
}
