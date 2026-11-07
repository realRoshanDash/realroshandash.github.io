/**
 * Sätteri HAST plugin: a document's top heading level becomes h2, whatever the author started from, so the page's
 * one <h1> stays the title and the outline never skips a level (WCAG 1.3.1; spec §8.5 "headings in order").
 *
 *   ### Section / #### Sub   (the restored 2021 posts)  →  <h2> / <h3>
 *   # Section / ## Sub       (an editor's H1 button)     →  <h2> / <h3>
 *
 * Only the offset changes; levels below the top keep their relative depth (capped at h6). The GFM footnotes
 * label is the footnote section's own heading and is never counted or moved.
 */
import { defineHastPlugin } from 'satteri';

const HEADING = /^h([1-6])$/;
const KEY = 'rdHeadingShift';

interface Node {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: readonly Node[];
}

const isFootnoteLabel = (node: Node) => node.properties?.id === 'footnote-label';

/** The smallest heading level in the tree, ignoring the footnotes section; 0 when there is none. */
function topLevel(node: Node): number {
  let top = 0;
  const walk = (current: Node) => {
    if (current.type === 'element') {
      if (current.properties?.dataFootnotes !== undefined) return;
      const level = HEADING.exec(current.tagName ?? '')?.[1];
      if (level && !isFootnoteLabel(current)) top = top ? Math.min(top, Number(level)) : Number(level);
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return top;
}

export const normalizeHeadings = defineHastPlugin({
  name: 'normalize-headings',
  before(root, ctx) {
    const top = topLevel(root as unknown as Node);
    ctx.data[KEY] = top ? 2 - top : 0;
  },
  element: {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    visit(node, ctx) {
      const shift = Number(ctx.data[KEY] ?? 0);
      if (!shift || isFootnoteLabel(node as unknown as Node)) return;
      const level = Number(node.tagName.slice(1));
      return { ...node, tagName: `h${Math.min(6, Math.max(2, level + shift))}` };
    },
  },
});
