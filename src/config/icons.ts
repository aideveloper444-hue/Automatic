/**
 * Centered line-icon glyphs, one per SERVICE_TOPICS entry (see brand.ts).
 * Each returns a satori-compatible <svg> element tree (satori natively
 * understands svg/path/circle/rect/line/polygon — no rasterization needed),
 * drawn on a 24x24 viewBox so every icon drops into iconBadge() at any size.
 */

type SatoriNode = { type: string; props: Record<string, unknown> };

function svg(children: SatoriNode[]): SatoriNode {
  return {
    type: 'svg',
    props: {
      viewBox: '0 0 24 24',
      width: '100%',
      height: '100%',
      fill: 'none',
      children,
    },
  };
}

function path(d: string, extra: Record<string, unknown> = {}): SatoriNode {
  return { type: 'path', props: { d, ...extra } };
}

function circle(cx: number, cy: number, r: number, extra: Record<string, unknown> = {}): SatoriNode {
  return { type: 'circle', props: { cx, cy, r, ...extra } };
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
): SatoriNode {
  return { type: 'rect', props: { x, y, width, height, ...extra } };
}

function line(x1: number, y1: number, x2: number, y2: number, extra: Record<string, unknown> = {}): SatoriNode {
  return { type: 'line', props: { x1, y1, x2, y2, ...extra } };
}

/** Shared stroke treatment so every icon reads as one consistent family. */
function stroked(node: SatoriNode, stroke: string): SatoriNode {
  return {
    ...node,
    props: { ...node.props, stroke, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
  };
}

const ICON_BUILDERS: Record<string, (stroke: string, glow: string) => SatoriNode> = {
  'Cloud Native Solutions': (stroke, glow) =>
    svg([
      stroked(path('M6.5 17a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 16.9 8.3 4.5 4.5 0 0 1 16.5 17h-10z'), stroke),
      stroked(path('M12 10.5v6.5m0-6.5-2.3 2.3M12 10.5l2.3 2.3'), glow),
    ]),

  'AI Model Development': (stroke, glow) =>
    svg([
      stroked(rect(6, 6, 12, 12, { rx: 2.5 }), stroke),
      stroked(circle(9.5, 9.5, 1.1, { fill: glow, stroke: 'none' }), stroke),
      stroked(circle(14.5, 9.5, 1.1, { fill: glow, stroke: 'none' }), stroke),
      stroked(path('M9 15h6'), glow),
      stroked(line(9, 3, 9, 6), stroke),
      stroked(line(15, 3, 15, 6), stroke),
      stroked(line(9, 18, 9, 21), stroke),
      stroked(line(15, 18, 15, 21), stroke),
      stroked(line(3, 9, 6, 9), stroke),
      stroked(line(18, 9, 21, 9), stroke),
      stroked(line(3, 15, 6, 15), stroke),
      stroked(line(18, 15, 21, 15), stroke),
    ]),

  'Enterprise Solutions': (stroke, glow) =>
    svg([
      stroked(circle(12, 6, 2.2), stroke),
      stroked(circle(5.5, 18, 2.2), stroke),
      stroked(circle(18.5, 18, 2.2), stroke),
      stroked(path('M12 8.2V13m0 0-5 3m5-3 5 3'), glow),
    ]),

  'Data Engineering': (stroke, glow) =>
    svg([
      stroked(path('M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2z'), stroke),
      stroked(path('M4 6v12c0 1.1 3.6 2 8 2s8-.9 8-2V6'), stroke),
      stroked(path('M4 12c0 1.1 3.6 2 8 2s8-.9 8-2'), stroke),
      stroked(path('M12 9.5V17m0 0-2.2-2.2M12 17l2.2-2.2'), glow),
    ]),

  'Quality Assurance': (stroke, glow) =>
    svg([
      stroked(path('M12 3.5l6.5 2.4V11c0 4.4-2.8 7.7-6.5 9.5-3.7-1.8-6.5-5.1-6.5-9.5V5.9L12 3.5z'), stroke),
      stroked(path('M9 12.2l2.1 2.1L15.5 10'), glow),
    ]),

  'Product Design': (stroke, glow) =>
    svg([
      stroked(rect(5, 5, 10, 10, { rx: 1.5 }), stroke),
      stroked(rect(8.5, 8.5, 10, 10, { rx: 1.5 }), glow),
    ]),

  'Mobile App Maintenance': (stroke, glow) =>
    svg([
      stroked(rect(7, 3, 10, 18, { rx: 2.2 }), stroke),
      stroked(line(10, 18, 14, 18), stroke),
      stroked(circle(17, 16.5, 3, { fill: '#0a121f' }), glow),
      stroked(path('M17 15v1.5l1 .8'), glow),
    ]),

  'Cyber Security': (stroke, glow) =>
    svg([
      stroked(path('M12 3.5l6.5 2.4V11c0 4.4-2.8 7.7-6.5 9.5-3.7-1.8-6.5-5.1-6.5-9.5V5.9L12 3.5z'), stroke),
      stroked(rect(9.7, 11, 4.6, 4, { rx: 1 }), glow),
      stroked(path('M10.6 11V9.5a1.4 1.4 0 0 1 2.8 0V11'), glow),
    ]),

  'IT Infrastructure': (stroke, glow) =>
    svg([
      stroked(rect(5, 4, 14, 5, { rx: 1.2 }), stroke),
      stroked(rect(5, 10.5, 14, 5, { rx: 1.2 }), stroke),
      stroked(rect(5, 17, 14, 3, { rx: 1.2 }), stroke),
      stroked(circle(8, 6.5, 0.6, { fill: glow, stroke: 'none' }), stroke),
      stroked(circle(8, 13, 0.6, { fill: glow, stroke: 'none' }), stroke),
    ]),

  'Emerging Technologies': (stroke, glow) =>
    svg([
      stroked(path('M12 3.2 19 7v10l-7 3.8L5 17V7l7-3.8z'), stroke),
      stroked(circle(12, 12, 2.4), glow),
    ]),
};

export function getTopicIcon(topicName: string, stroke: string, glow: string): SatoriNode {
  const builder = ICON_BUILDERS[topicName];
  if (!builder) {
    return svg([stroked(circle(12, 12, 7), stroke)]);
  }
  return builder(stroke, glow);
}
