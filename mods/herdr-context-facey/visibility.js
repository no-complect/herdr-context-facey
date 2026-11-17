// Source: src/visibility.ts. Run npm run build to update the runtime JavaScript.
// Return null when the copy is outside the layout tree (for example, a pane).
export function layoutVisibility(root, mod, blockId) {
  let found = false,
    visible = false;
  function visit(value, parentVisible) {
    if (!value || typeof value !== "object") return;
    const node = value;
    const shown = parentVisible && node.hidden !== true;
    const content = node.content;
    if (content?.mod === mod && (!blockId || node.id === blockId)) {
      found = true;
      visible ||= shown;
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      const id = child?.id;
      visit(child, shown && (node.type !== "stack" || !node.active || id === node.active));
    }
  }
  visit(root, true);
  return found ? visible : null;
}
