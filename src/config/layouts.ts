/**
 * Structural post layouts, rotated per slot alongside content themes (see
 * content-themes.ts) so the feed doesn't look like the same template with
 * swapped text every time. See template.service.ts for the actual tree
 * builders.
 */
export const LAYOUT_IDS = ['editorial', 'quote', 'split', 'full-bleed'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

export function pickLayout(excludeIds: string[] = []): LayoutId {
  const excludeSet = new Set(excludeIds);
  const filtered = LAYOUT_IDS.filter((id) => !excludeSet.has(id));
  const pool = filtered.length > 0 ? filtered : LAYOUT_IDS;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
