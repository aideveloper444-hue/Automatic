import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { BRAND, IMAGE_DIMENSIONS, ServiceTopic } from '../config/brand.js';
import { getTopicIcon } from '../config/icons.js';
import { ImpactCardData, ImpactStat, TextSpan } from '../config/impact-content.js';
import type { ContentTheme } from '../config/content-themes.js';
import type { LayoutId } from '../config/layouts.js';
import type { ThemedPostPayload } from './gemini.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'brand-reference', 'logo-transparent.png');
const LOGO_WHITE_PATH = path.join(__dirname, '..', 'assets', 'brand-reference', 'logo-white.png');

const HOUSE = {
  bg: '#f5f6f8',
  ink: '#0c0c0d',
  inkDim: '#5a5f6b',
  accent: '#1c4bff',
  accentDim: 'rgba(28,75,255,0.1)',
  dark: '#0b1220',
  darkSoft: '#131b2c',
  line: '#e1e4ea',
};

const PALETTE = {
  bg: '#05070c',
  cardTop: '#0c1220',
  cardBottom: '#060911',
  accent: '#3ec6ff',
  accent2: '#7fe0ff',
  accentDim: '#123246',
  ink: '#f4f8fc',
  inkDim: '#93a4bd',
  line: '#1c2536',
  chipBg: '#0a0f1a',
};

const LIGHT_PALETTE = {
  bg: '#f5f6f8',
  ink: '#0c0c0d',
  inkDim: '#5a5f6b',
  accent: '#1c4bff',
  accentDim: 'rgba(28,75,255,0.1)',
  paper: '#fbfbfa',
  shadowCard: '#0a0a0a',
  statBar: '#0a0a0c',
};

const IMPACT_ICON_PATHS: Record<ImpactStat['icon'], string[]> = {
  rocket: [
    'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z',
    'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z',
    'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0',
    'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
  ],
  chart: ['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
  people: [
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M23 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
};

const SEND_ICON_PATHS = ['M22 2 11 13', 'M22 2 15 22 11 13 2 9 22 2z'];
const GLOBE_ICON_PATH =
  'M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z';
const ENVELOPE_ICON_PATH = 'M3 5h18v14H3zM3 7l9 6 9-6';
const PAPERCLIP_ICON_PATH = 'M8 12.5 15 5a3.2 3.2 0 0 1 4.5 4.5l-9 9a5 5 0 1 1-7-7L12 3';

type SatoriNode = { type: string; props: Record<string, unknown> };
type Platform = keyof typeof IMAGE_DIMENSIONS;

function el(type: string, style: Record<string, unknown>, children?: unknown): SatoriNode {
  return { type, props: children === undefined ? { style } : { style, children } };
}

function logoMark(size: number): SatoriNode {
  return {
    type: 'svg',
    props: {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      children: [
        { type: 'path', props: { d: 'M12 2 L22 20 L16 20 L12 12 L8 20 L2 20 Z', fill: PALETTE.ink } },
        { type: 'path', props: { d: 'M12 12 L16 20 L8 20 Z', fill: PALETTE.accent } },
      ],
    },
  };
}

function logoRow(scale: number): SatoriNode {
  return el('div', { display: 'flex', alignItems: 'center', gap: 8 * scale }, [
    logoMark(22 * scale),
    el(
      'div',
      {
        display: 'flex',
        fontSize: 15 * scale,
        fontWeight: 800,
        letterSpacing: 1 * scale,
        color: PALETTE.ink,
        fontFamily: 'Manrope',
      },
      'ALPHAZO',
    ),
    el(
      'div',
      {
        display: 'flex',
        fontSize: 15 * scale,
        fontWeight: 800,
        letterSpacing: 1 * scale,
        color: PALETTE.accent,
        fontFamily: 'Manrope',
        marginLeft: -7 * scale,
      },
      'X',
    ),
  ]);
}

function pill(iconPath: string, text: string, scale: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
      gap: 6 * scale,
      padding: `${7 * scale}px ${12 * scale}px`,
      borderRadius: 999,
      background: PALETTE.chipBg,
      border: `1px solid ${PALETTE.line}`,
    },
    [
      {
        type: 'svg',
        props: {
          viewBox: '0 0 24 24',
          width: 12 * scale,
          height: 12 * scale,
          fill: 'none',
          children: [
            {
              type: 'path',
              props: {
                d: iconPath,
                stroke: PALETTE.accent2,
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
              },
            },
          ],
        },
      },
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'JetBrains Mono',
          fontSize: 11 * scale,
          color: PALETTE.inkDim,
        },
        text,
      ),
    ],
  );
}

function footerRow(scale: number): SatoriNode {
  return el('div', { display: 'flex', gap: 8 * scale }, [
    pill(
      'M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z',
      BRAND.website,
      scale,
    ),
    pill('M3 5h18v14H3zM3 7l9 6 9-6', BRAND.supportEmail, scale),
  ]);
}

function headlineBlock(topic: ServiceTopic, scale: number, maxWidth?: number): SatoriNode {
  const words = topic.name.split(' ');
  const lastWord = words[words.length - 1];
  const firstLine = words.slice(0, -1).join(' ');

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', ...(maxWidth ? { width: maxWidth } : {}) },
    [
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Manrope',
          fontWeight: 800,
          fontSize: 40 * scale,
          lineHeight: 1.08,
          color: PALETTE.ink,
          letterSpacing: -0.5 * scale,
        },
        [
          firstLine ? el('div', { display: 'flex' }, firstLine) : null,
          el('div', { display: 'flex', color: PALETTE.accent2 }, lastWord),
        ].filter(Boolean),
      ),
      el('div', {
        display: 'flex',
        width: 44 * scale,
        height: 3 * scale,
        borderRadius: 2,
        background: PALETTE.accent,
        marginTop: 16 * scale,
        marginBottom: 12 * scale,
      }),
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'Manrope',
          fontSize: 15 * scale,
          color: PALETTE.inkDim,
          maxWidth: 320 * scale,
        },
        topic.tagline,
      ),
    ],
  );
}

function capabilityList(topic: ServiceTopic, scale: number): SatoriNode {
  return el(
    'div',
    { display: 'flex', flexDirection: 'column', gap: 10 * scale, marginTop: 22 * scale },
    topic.capabilities.slice(0, 4).map((capability) =>
      el('div', { display: 'flex', alignItems: 'center', gap: 11 * scale }, [
        el('div', {
          display: 'flex',
          width: 20 * scale,
          height: 20 * scale,
          borderRadius: 6,
          border: `1px solid ${PALETTE.accentDim}`,
          background: 'rgba(62,198,255,0.08)',
          alignItems: 'center',
          justifyContent: 'center',
        }, [
          el('div', {
            display: 'flex',
            width: 6 * scale,
            height: 6 * scale,
            borderRadius: 2,
            background: PALETTE.accent2,
          }),
        ]),
        el(
          'div',
          { display: 'flex', fontFamily: 'Manrope', fontSize: 14 * scale, color: '#dbe4f0' },
          capability,
        ),
      ]),
    ),
  );
}

function iconBadge(topic: ServiceTopic, size: number, heroImageDataUri?: string): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      width: size,
      height: size,
      borderRadius: size * 0.16,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background: `linear-gradient(155deg, #16233a 0%, #0a121f 100%)`,
      border: `1px solid rgba(127,224,255,0.35)`,
      boxShadow: `0 0 ${size * 0.32}px ${size * 0.03}px rgba(62,198,255,0.45)`,
    },
    heroImageDataUri
      ? [
          {
            type: 'img',
            props: {
              src: heroImageDataUri,
              width: size,
              height: size,
              style: { objectFit: 'cover' },
            },
          },
        ]
      : [
          el(
            'div',
            { display: 'flex', width: size * 0.46, height: size * 0.46 },
            getTopicIcon(topic.name, PALETTE.accent2, PALETTE.accent),
          ),
        ],
  );
}

function buildSquareTree(
  topic: ServiceTopic,
  width: number,
  height: number,
  heroImageDataUri?: string,
): SatoriNode {
  const scale = width / 1080;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width,
      height,
      padding: 56 * scale,
      background: `linear-gradient(165deg, ${PALETTE.cardTop} 0%, ${PALETTE.cardBottom} 100%)`,
      fontFamily: 'Manrope',
    },
    [
      logoRow(scale * 1.3),
      el('div', { display: 'flex', marginTop: 40 * scale }, [headlineBlock(topic, scale * 1.3)]),
      capabilityList(topic, scale * 1.3),
      el(
        'div',
        { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 20 * scale },
        [iconBadge(topic, 220 * scale, heroImageDataUri)],
      ),
      el('div', { display: 'flex', marginTop: 16 * scale }, [footerRow(scale * 1.3)]),
    ],
  );
}

function buildLandscapeTree(
  topic: ServiceTopic,
  width: number,
  height: number,
  heroImageDataUri?: string,
): SatoriNode {
  const scale = height / 627;

  return el(
    'div',
    {
      display: 'flex',
      width,
      height,
      padding: 48 * scale,
      background: `linear-gradient(120deg, ${PALETTE.cardTop} 0%, ${PALETTE.cardBottom} 100%)`,
      fontFamily: 'Manrope',
    },
    [
      el(
        'div',
        { display: 'flex', flexDirection: 'column', width: width * 0.56, justifyContent: 'space-between' },
        [
          el('div', { display: 'flex', flexDirection: 'column' }, [
            logoRow(scale),
            el('div', { display: 'flex', marginTop: 22 * scale }, [
              headlineBlock(topic, scale * 0.92, width * 0.5),
            ]),
            capabilityList(topic, scale * 0.9),
          ]),
          footerRow(scale * 0.95),
        ],
      ),
      el(
        'div',
        { display: 'flex', width: width * 0.44, alignItems: 'center', justifyContent: 'center' },
        [iconBadge(topic, 200 * scale, heroImageDataUri)],
      ),
    ],
  );
}

function strokeIcon(
  paths: string[],
  size: number,
  stroke: string,
  strokeWidth = 1.8,
): SatoriNode {
  return {
    type: 'svg',
    props: {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      children: paths.map((d) => ({
        type: 'path',
        props: { d, stroke, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' },
      })),
    },
  };
}

function starRow(scale: number): SatoriNode {
  const star =
    'M12 2.5l2.7 6 6.5.6-4.9 4.4 1.5 6.4L12 16.6l-5.8 3.3 1.5-6.4-4.9-4.4 6.5-.6L12 2.5z';

  const buildStar = (): SatoriNode => ({
    type: 'svg',
    props: {
      viewBox: '0 0 24 24',
      width: 16 * scale,
      height: 16 * scale,
      children: [{ type: 'path', props: { d: star, fill: LIGHT_PALETTE.accent } }],
    },
  });

  return el(
    'div',
    { display: 'flex', gap: 4 * scale, marginTop: 14 * scale },
    Array.from({ length: 5 }, buildStar),
  );
}

function textSpanRow(spans: TextSpan[], baseColor: string, accentColor: string): SatoriNode[] {
  return spans.map((span) =>
    el('div', { display: 'flex', color: span.accent ? accentColor : baseColor }, span.text),
  );
}

function lightLogoRow(scale: number): SatoriNode {
  return el('div', { display: 'flex', alignItems: 'center', gap: 8 * scale }, [
    {
      type: 'svg',
      props: {
        viewBox: '0 0 24 24',
        width: 26 * scale,
        height: 26 * scale,
        fill: 'none',
        children: [
          { type: 'path', props: { d: 'M12 2 L22 20 L16 20 L12 12 L8 20 L2 20 Z', fill: LIGHT_PALETTE.ink } },
          { type: 'path', props: { d: 'M12 12 L16 20 L8 20 Z', fill: LIGHT_PALETTE.accent } },
        ],
      },
    },
    el(
      'div',
      {
        display: 'flex',
        fontSize: 20 * scale,
        fontWeight: 800,
        letterSpacing: 1 * scale,
        color: LIGHT_PALETTE.ink,
        fontFamily: 'Manrope',
      },
      'ALPHAZO',
    ),
    el(
      'div',
      {
        display: 'flex',
        fontSize: 20 * scale,
        fontWeight: 800,
        letterSpacing: 1 * scale,
        color: LIGHT_PALETTE.accent,
        fontFamily: 'Manrope',
        marginLeft: -8 * scale,
      },
      'X',
    ),
  ]);
}

function dotGrid(scale: number): SatoriNode {
  return el(
    'div',
    { display: 'flex', flexDirection: 'column', gap: 10 * scale },
    Array.from({ length: 3 }, () =>
      el(
        'div',
        { display: 'flex', gap: 10 * scale },
        Array.from({ length: 4 }, () =>
          el('div', {
            display: 'flex',
            width: 5 * scale,
            height: 5 * scale,
            borderRadius: 5,
            background: LIGHT_PALETTE.accent,
          }),
        ),
      ),
    ),
  );
}

function testimonialNote(data: ImpactCardData, scale: number): SatoriNode {
  const cardWidth = 480 * scale;
  const cardHeight = 500 * scale;

  return el(
    'div',
    {
      display: 'flex',
      position: 'relative',
      width: cardWidth + 40 * scale,
      height: cardHeight + 40 * scale,
    },
    [
    el('div', {
      display: 'flex',
      position: 'absolute',
      left: 18 * scale,
      top: 18 * scale,
      width: cardWidth,
      height: cardHeight,
      background: LIGHT_PALETTE.shadowCard,
      borderRadius: 10 * scale,
    }),
    el(
      'div',
      {
        position: 'absolute',
        left: 0,
        top: 0,
        width: cardWidth,
        height: cardHeight,
        background: LIGHT_PALETTE.paper,
        borderRadius: 10 * scale,
        display: 'flex',
        flexDirection: 'column',
        padding: 36 * scale,
      },
      [
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 700,
            fontStyle: 'italic',
            fontSize: 22 * scale,
            color: LIGHT_PALETTE.accent,
          },
          data.quoteLabel,
        ),
        el('div', {
          display: 'flex',
          width: 140 * scale,
          height: 2 * scale,
          background: LIGHT_PALETTE.accent,
          marginTop: 8 * scale,
          marginBottom: 20 * scale,
        }),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 800,
            fontSize: 48 * scale,
            color: LIGHT_PALETTE.accent,
            lineHeight: 1,
          },
          '“',
        ),
        el(
          'div',
          {
            display: 'flex',
            flexWrap: 'wrap',
            fontFamily: 'Manrope',
            fontWeight: 600,
            fontSize: 24 * scale,
            lineHeight: 1.4,
            color: LIGHT_PALETTE.ink,
            marginTop: 8 * scale,
          },
          textSpanRow(data.quote, LIGHT_PALETTE.ink, LIGHT_PALETTE.accent),
        ),
        el('div', {
          display: 'flex',
          flex: 1,
        }),
        el('div', {
          display: 'flex',
          width: 60 * scale,
          height: 2 * scale,
          background: '#d8d8d8',
          marginBottom: 14 * scale,
        }),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 600,
            fontSize: 16 * scale,
            color: LIGHT_PALETTE.inkDim,
          },
          data.attribution,
        ),
        starRow(scale),
      ],
    ),
    el(
      'div',
      {
        display: 'flex',
        position: 'absolute',
        left: 26 * scale,
        top: -6 * scale,
        transform: 'rotate(-25deg)',
      },
      [strokeIcon([PAPERCLIP_ICON_PATH], 40 * scale, LIGHT_PALETTE.accent, 2.2)],
    ),
  ]);
}

function headlineImpactBlock(data: ImpactCardData, scale: number, maxWidth: number): SatoriNode {
  return el('div', { display: 'flex', flexDirection: 'column', width: maxWidth }, [
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Manrope',
        fontWeight: 800,
        fontSize: 34 * scale,
        lineHeight: 1.08,
        letterSpacing: -0.3 * scale,
      },
      data.headline.map((line) =>
        el(
          'div',
          { display: 'flex', color: line.accent ? LIGHT_PALETTE.accent : LIGHT_PALETTE.ink },
          line.text,
        ),
      ),
    ),
    el('div', {
      display: 'flex',
      width: 70 * scale,
      height: 3 * scale,
      background: LIGHT_PALETTE.ink,
      marginTop: 20 * scale,
      marginBottom: 16 * scale,
    }),
    el(
      'div',
      {
        display: 'flex',
        flexWrap: 'wrap',
        fontFamily: 'Manrope',
        fontWeight: 500,
        fontSize: 16 * scale,
        lineHeight: 1.5,
        width: maxWidth,
      },
      textSpanRow(data.subtext, LIGHT_PALETTE.inkDim, LIGHT_PALETTE.accent),
    ),
  ]);
}

function partnershipBadge(size: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      width: size,
      height: size,
      borderRadius: size,
      alignItems: 'center',
      justifyContent: 'center',
      background: LIGHT_PALETTE.accent,
    },
    [
      {
        type: 'svg',
        props: {
          viewBox: '0 0 24 24',
          width: size * 0.5,
          height: size * 0.5,
          fill: 'none',
          children: [
            { type: 'circle', props: { cx: 9, cy: 12, r: 6.5, stroke: '#ffffff', strokeWidth: 1.6 } },
            { type: 'circle', props: { cx: 15, cy: 12, r: 6.5, stroke: '#ffffff', strokeWidth: 1.6 } },
          ],
        },
      },
    ],
  );
}

function statItem(stat: ImpactStat, scale: number): SatoriNode {
  return el(
    'div',
    { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 6 * scale },
    [
      el(
        'div',
        {
          display: 'flex',
          width: 34 * scale,
          height: 34 * scale,
          borderRadius: 34,
          border: `1.5px solid ${LIGHT_PALETTE.accent}`,
          alignItems: 'center',
          justifyContent: 'center',
        },
        [strokeIcon(IMPACT_ICON_PATHS[stat.icon], 16 * scale, '#ffffff')],
      ),
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'baseline',
          gap: 5 * scale,
        },
        [
          el(
            'div',
            { display: 'flex', fontFamily: 'Manrope', fontWeight: 800, fontSize: 22 * scale, color: LIGHT_PALETTE.accent },
            stat.value,
          ),
          el(
            'div',
            { display: 'flex', fontFamily: 'Manrope', fontWeight: 700, fontSize: 12 * scale, color: '#ffffff' },
            stat.label,
          ),
        ],
      ),
      el(
        'div',
        { display: 'flex', fontFamily: 'Manrope', fontWeight: 400, fontSize: 12 * scale, color: '#9aa0ab' },
        stat.description,
      ),
    ],
  );
}

function statBar(data: ImpactCardData, width: number, scale: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      width,
      alignItems: 'center',
      justifyContent: 'space-between',
      background: LIGHT_PALETTE.statBar,
      borderRadius: 999,
      padding: `${20 * scale}px ${28 * scale}px`,
    },
    data.stats.flatMap((stat, index) => {
      const item = statItem(stat, scale);
      if (index === 0) return [item];
      return [
        el('div', { display: 'flex', width: 1, height: 44 * scale, background: '#2a2a2e' }),
        item,
      ];
    }),
  );
}

function ctaBar(data: ImpactCardData, width: number, scale: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      width,
      alignItems: 'center',
      justifyContent: 'space-between',
      background: LIGHT_PALETTE.paper,
      borderRadius: 999,
      border: '1px solid #e4e4e6',
      padding: `${10 * scale}px ${10 * scale}px ${10 * scale}px ${10 * scale}px`,
    },
    [
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          gap: 12 * scale,
          background: LIGHT_PALETTE.accent,
          borderRadius: 999,
          padding: `${12 * scale}px ${20 * scale}px`,
        },
        [
          el(
            'div',
            {
              display: 'flex',
              width: 30 * scale,
              height: 30 * scale,
              borderRadius: 30,
              background: 'rgba(255,255,255,0.18)',
              alignItems: 'center',
              justifyContent: 'center',
            },
            [strokeIcon(SEND_ICON_PATHS, 15 * scale, '#ffffff', 2)],
          ),
          el(
            'div',
            {
              display: 'flex',
              fontFamily: 'Manrope',
              fontWeight: 700,
              fontSize: 15 * scale,
              color: '#ffffff',
              maxWidth: 220 * scale,
              lineHeight: 1.25,
            },
            data.ctaText,
          ),
        ],
      ),
      el('div', { display: 'flex', alignItems: 'center', gap: 10 * scale, paddingRight: 12 * scale }, [
        strokeIcon([GLOBE_ICON_PATH], 20 * scale, LIGHT_PALETTE.accent, 1.8),
        el(
          'div',
          { display: 'flex', fontFamily: 'Manrope', fontWeight: 600, fontSize: 15 * scale, color: LIGHT_PALETTE.ink },
          BRAND.website,
        ),
      ]),
      el('div', { display: 'flex', width: 1, height: 24 * scale, background: '#e4e4e6' }),
      el('div', { display: 'flex', alignItems: 'center', gap: 10 * scale, paddingRight: 8 * scale }, [
        strokeIcon([ENVELOPE_ICON_PATH], 20 * scale, LIGHT_PALETTE.accent, 1.8),
        el(
          'div',
          { display: 'flex', fontFamily: 'Manrope', fontWeight: 600, fontSize: 15 * scale, color: LIGHT_PALETTE.ink },
          BRAND.supportEmail,
        ),
      ]),
    ],
  );
}

function buildImpactSquareTree(data: ImpactCardData, width: number, height: number): SatoriNode {
  const scale = width / 1080;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width,
      height,
      padding: 48 * scale,
      background: LIGHT_PALETTE.bg,
      fontFamily: 'Manrope',
    },
    [
      el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }, [
        lightLogoRow(scale),
        dotGrid(scale),
      ]),
      el(
        'div',
        {
          display: 'flex',
          flex: 1,
          marginTop: 24 * scale,
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        [
          testimonialNote(data, scale * 1.18),
          el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              height: 630 * scale,
            },
            [headlineImpactBlock(data, scale * 0.86, 360 * scale), partnershipBadge(170 * scale)],
          ),
        ],
      ),
      el('div', { display: 'flex', marginTop: 28 * scale }, [statBar(data, width - 96 * scale, scale)]),
      el('div', { display: 'flex', marginTop: 20 * scale }, [ctaBar(data, width - 96 * scale, scale)]),
    ],
  );
}

function socialCircle(scale: number, child: SatoriNode): SatoriNode {
  const size = 26 * scale;
  return el(
    'div',
    {
      display: 'flex',
      width: size,
      height: size,
      borderRadius: size,
      background: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    [child],
  );
}

function socialRow(scale: number): SatoriNode {
  const label = (text: string, size: number): SatoriNode =>
    el(
      'div',
      { display: 'flex', fontFamily: 'Manrope', fontWeight: 800, fontSize: size, color: '#ffffff' },
      text,
    );

  return el('div', { display: 'flex', gap: 8 * scale }, [
    socialCircle(scale, label('in', 11 * scale)),
    socialCircle(
      scale,
      strokeIcon(
        ['M4 4h16v16H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M16.5 7.5h.01'],
        13 * scale,
        '#ffffff',
        1.7,
      ),
    ),
    socialCircle(scale, label('f', 12 * scale)),
    socialCircle(
      scale,
      strokeIcon(
        [
          'M22 4.5a8.6 8.6 0 0 1-2.36.8A4.1 4.1 0 0 0 21.4 3a8.2 8.2 0 0 1-2.6 1 4.1 4.1 0 0 0-7 3.7A11.6 11.6 0 0 1 3.2 3.6a4.1 4.1 0 0 0 1.27 5.47A4 4 0 0 1 2.6 8.5v.05a4.1 4.1 0 0 0 3.3 4 4.2 4.2 0 0 1-1.85.07 4.1 4.1 0 0 0 3.83 2.85A8.3 8.3 0 0 1 2 17.4a11.6 11.6 0 0 0 6.29 1.84c7.55 0 11.68-6.26 11.68-11.68l-.01-.53A8.3 8.3 0 0 0 22 4.5z',
        ],
        13 * scale,
        '#ffffff',
        1.3,
      ),
    ),
  ]);
}

function houseFooterBar(width: number, scale: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      width,
      alignItems: 'center',
      justifyContent: 'space-between',
      background: HOUSE.dark,
      borderRadius: 16 * scale,
      padding: `${16 * scale}px ${24 * scale}px`,
    },
    [
      el('div', { display: 'flex', alignItems: 'center', gap: 10 * scale }, [
        strokeIcon(
          ['M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z'],
          18 * scale,
          '#7fe0ff',
          1.8,
        ),
        el('div', { display: 'flex', flexDirection: 'column' }, [
          el(
            'div',
            { display: 'flex', fontFamily: 'Manrope', fontWeight: 700, fontSize: 9 * scale, color: '#8fa3bf' },
            'VISIT OUR WEBSITE',
          ),
          el(
            'div',
            { display: 'flex', fontFamily: 'Manrope', fontWeight: 700, fontSize: 12.5 * scale, color: '#ffffff' },
            BRAND.website,
          ),
        ]),
      ]),
      el('div', { display: 'flex', alignItems: 'center', gap: 10 * scale }, [
        strokeIcon(['M3 5h18v14H3zM3 7l9 6 9-6'], 18 * scale, '#7fe0ff', 1.8),
        el('div', { display: 'flex', flexDirection: 'column' }, [
          el(
            'div',
            { display: 'flex', fontFamily: 'Manrope', fontWeight: 700, fontSize: 9 * scale, color: '#8fa3bf' },
            'REACH OUT TO US',
          ),
          el(
            'div',
            { display: 'flex', fontFamily: 'Manrope', fontWeight: 700, fontSize: 12.5 * scale, color: '#ffffff' },
            BRAND.supportEmail,
          ),
        ]),
      ]),
      socialRow(scale),
    ],
  );
}

function houseQuoteBanner(topic: ServiceTopic, width: number, scale: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      width,
      flexDirection: 'column',
      background: `linear-gradient(160deg, ${HOUSE.darkSoft} 0%, ${HOUSE.dark} 100%)`,
      borderRadius: 16 * scale,
      padding: `${20 * scale}px ${26 * scale}px`,
      gap: 6 * scale,
    },
    [
      el(
        'div',
        { display: 'flex', fontFamily: 'Manrope', fontWeight: 800, fontSize: 19 * scale, color: '#ffffff', lineHeight: 1.2 },
        [
          el('span', { color: '#5b8dff' }, '“'),
          `${topic.tagline}`,
        ] as never,
      ),
      el(
        'div',
        { display: 'flex', fontFamily: 'Manrope', fontWeight: 500, fontSize: 12.5 * scale, color: '#93a4bd' },
        `${BRAND.name} — ${topic.name}`,
      ),
    ],
  );
}

function whatWeDoRow(topic: ServiceTopic, width: number, scale: number): SatoriNode {
  const items = topic.capabilities.slice(0, 5);
  const checkPath = 'M5 12.5l4.5 4.5L19 7';

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', width, gap: 12 * scale },
    [
      el(
        'div',
        { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 * scale },
        [
          el('div', { display: 'flex', width: 40 * scale, height: 1, background: HOUSE.line }),
          el(
            'div',
            { display: 'flex', fontFamily: 'Manrope', fontWeight: 800, fontSize: 14 * scale, color: HOUSE.ink, letterSpacing: 0.5 },
            'WHAT WE DO',
          ),
          el('div', { display: 'flex', width: 40 * scale, height: 1, background: HOUSE.line }),
        ],
      ),
      el(
        'div',
        { display: 'flex', justifyContent: 'space-between' },
        items.map((capability) =>
          el(
            'div',
            { display: 'flex', flexDirection: 'column', alignItems: 'center', width: width / items.length, gap: 6 * scale },
            [
              el(
                'div',
                {
                  display: 'flex',
                  width: 34 * scale,
                  height: 34 * scale,
                  borderRadius: 34,
                  border: `1.5px solid ${HOUSE.accent}`,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                [strokeIcon([checkPath], 15 * scale, HOUSE.accent, 2)],
              ),
              el(
                'div',
                {
                  display: 'flex',
                  textAlign: 'center',
                  fontFamily: 'Manrope',
                  fontWeight: 700,
                  fontSize: 9.5 * scale,
                  lineHeight: 1.25,
                  color: HOUSE.ink,
                  maxWidth: width / items.length - 4 * scale,
                },
                capability,
              ),
            ],
          ),
        ),
      ),
    ],
  );
}

function buildHouseStyleSquareTree(
  topic: ServiceTopic,
  width: number,
  height: number,
  heroArtDataUri: string,
  logoDataUri: string,
): SatoriNode {
  const scale = width / 1080;
  const contentWidth = width - 96 * scale;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width,
      height,
      padding: 48 * scale,
      gap: 16 * scale,
      background: HOUSE.bg,
      fontFamily: 'Manrope',
    },
    [
      el('div', { display: 'flex', justifyContent: 'center', width: contentWidth }, [
        {
          type: 'img',
          props: { src: logoDataUri, width: 110 * scale, height: 110 * scale, style: { objectFit: 'contain' } },
        },
      ]),
      el('div', { display: 'flex', flexDirection: 'column' }, [
        el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Manrope',
            fontWeight: 800,
            fontSize: 32 * scale,
            lineHeight: 1.1,
            color: HOUSE.ink,
            letterSpacing: -0.3 * scale,
          },
          [el('div', { display: 'flex' }, topic.tagline)],
        ),
        el('div', {
          display: 'flex',
          width: 44 * scale,
          height: 3 * scale,
          background: HOUSE.accent,
          marginTop: 12 * scale,
          marginBottom: 10 * scale,
        }),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 500,
            fontSize: 13.5 * scale,
            lineHeight: 1.4,
            color: HOUSE.inkDim,
          },
          `${topic.name}, done right — ${BRAND.name} builds it end to end.`,
        ),
      ]),
      el(
        'div',
        {
          display: 'flex',
          width: contentWidth,
          flex: 1,
          borderRadius: 20 * scale,
          overflow: 'hidden',
          background: HOUSE.dark,
        },
        [
          {
            type: 'img',
            props: {
              src: heroArtDataUri,
              width: contentWidth,
              height: '100%',
              style: { objectFit: 'cover' },
            },
          },
        ],
      ),
      whatWeDoRow(topic, contentWidth, scale),
      houseQuoteBanner(topic, contentWidth, scale),
      houseFooterBar(contentWidth, scale),
    ],
  );
}

function buildHouseStyleLandscapeTree(
  topic: ServiceTopic,
  width: number,
  height: number,
  heroArtDataUri: string,
  logoDataUri: string,
): SatoriNode {
  const scale = height / 627;
  const leftWidth = width * 0.55;
  const rightWidth = width * 0.4;

  return el(
    'div',
    {
      display: 'flex',
      width,
      height,
      padding: 36 * scale,
      gap: 28 * scale,
      background: HOUSE.bg,
      fontFamily: 'Manrope',
    },
    [
      el(
        'div',
        { display: 'flex', flexDirection: 'column', width: leftWidth, gap: 22 * scale },
        [
          el('div', { display: 'flex', flexDirection: 'column' }, [
            {
              type: 'img',
              props: { src: logoDataUri, width: 130 * scale, height: 46 * scale, style: { objectFit: 'contain' } },
            },
            el('div', { display: 'flex', flexDirection: 'column', marginTop: 16 * scale }, [
              el(
                'div',
                {
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: 'Manrope',
                  fontWeight: 800,
                  fontSize: 26 * scale,
                  lineHeight: 1.1,
                  color: HOUSE.ink,
                  letterSpacing: -0.3 * scale,
                },
                [el('div', { display: 'flex' }, topic.tagline)],
              ),
              el('div', {
                display: 'flex',
                width: 40 * scale,
                height: 3 * scale,
                background: HOUSE.accent,
                marginTop: 10 * scale,
                marginBottom: 8 * scale,
              }),
              el(
                'div',
                {
                  display: 'flex',
                  fontFamily: 'Manrope',
                  fontWeight: 500,
                  fontSize: 12 * scale,
                  lineHeight: 1.4,
                  color: HOUSE.inkDim,
                },
                `${topic.name}, done right — ${BRAND.name} builds it end to end.`,
              ),
            ]),
          ]),
          whatWeDoRow(topic, leftWidth, scale * 0.92),
          houseQuoteBanner(topic, leftWidth, scale * 0.8),
          houseFooterBar(leftWidth, scale * 0.86),
        ],
      ),
      el(
        'div',
        {
          display: 'flex',
          width: rightWidth,
          height: '100%',
          borderRadius: 18 * scale,
          overflow: 'hidden',
          background: HOUSE.dark,
        },
        [
          {
            type: 'img',
            props: {
              src: heroArtDataUri,
              width: rightWidth,
              height: '100%',
              style: { objectFit: 'cover' },
            },
          },
        ],
      ),
    ],
  );
}

function eyebrowPill(label: string, scale: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      alignSelf: 'flex-start',
      alignItems: 'center',
      gap: 6 * scale,
      padding: `${6 * scale}px ${13 * scale}px`,
      borderRadius: 999,
      background: HOUSE.dark,
    },
    [
      el('div', {
        display: 'flex',
        width: 5 * scale,
        height: 5 * scale,
        borderRadius: 5,
        background: '#7fe0ff',
      }),
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'Manrope',
          fontWeight: 700,
          fontSize: 10.5 * scale,
          letterSpacing: 0.6,
          color: '#ffffff',
        },
        label.toUpperCase(),
      ),
    ],
  );
}

function slimFooterRow(width: number, scale: number): SatoriNode {
  return el(
    'div',
    { display: 'flex', width, alignItems: 'center', justifyContent: 'space-between' },
    [
      el('div', { display: 'flex', alignItems: 'center', gap: 7 * scale }, [
        strokeIcon(
          ['M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z'],
          13 * scale,
          HOUSE.inkDim,
          1.8,
        ),
        el(
          'div',
          { display: 'flex', fontFamily: 'Manrope', fontWeight: 600, fontSize: 11.5 * scale, color: HOUSE.inkDim },
          BRAND.website,
        ),
      ]),
      el('div', { display: 'flex', alignItems: 'center', gap: 7 * scale }, [
        strokeIcon(['M3 5h18v14H3zM3 7l9 6 9-6'], 13 * scale, HOUSE.inkDim, 1.8),
        el(
          'div',
          { display: 'flex', fontFamily: 'Manrope', fontWeight: 600, fontSize: 11.5 * scale, color: HOUSE.inkDim },
          BRAND.supportEmail,
        ),
      ]),
    ],
  );
}

function themedHeadline(headline: string[], scale: number): SatoriNode {
  const fontSize = headline.length >= 3 ? 36 : headline.length === 2 ? 44 : 52;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Manrope',
      fontWeight: 800,
      fontSize: fontSize * scale,
      lineHeight: 1.12,
      color: HOUSE.ink,
      letterSpacing: -0.4 * scale,
    },
    headline.map((line) => el('div', { display: 'flex' }, line)),
  );
}

function lightSlimFooterRow(width: number, scale: number): SatoriNode {
  return el(
    'div',
    { display: 'flex', width, alignItems: 'center', justifyContent: 'space-between' },
    [
      el('div', { display: 'flex', alignItems: 'center', gap: 7 * scale }, [
        strokeIcon(
          ['M3 12h18M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z'],
          13 * scale,
          '#93a4bd',
          1.8,
        ),
        el(
          'div',
          { display: 'flex', fontFamily: 'Manrope', fontWeight: 600, fontSize: 11.5 * scale, color: '#93a4bd' },
          BRAND.website,
        ),
      ]),
      el('div', { display: 'flex', alignItems: 'center', gap: 7 * scale }, [
        strokeIcon(['M3 5h18v14H3zM3 7l9 6 9-6'], 13 * scale, '#93a4bd', 1.8),
        el(
          'div',
          { display: 'flex', fontFamily: 'Manrope', fontWeight: 600, fontSize: 11.5 * scale, color: '#93a4bd' },
          BRAND.supportEmail,
        ),
      ]),
    ],
  );
}

function lightEyebrowPill(label: string, scale: number): SatoriNode {
  return el(
    'div',
    {
      display: 'flex',
      alignSelf: 'flex-start',
      alignItems: 'center',
      gap: 6 * scale,
      padding: `${6 * scale}px ${13 * scale}px`,
      borderRadius: 999,
      background: 'rgba(255,255,255,0.12)',
      border: '1px solid rgba(255,255,255,0.18)',
    },
    [
      el('div', { display: 'flex', width: 5 * scale, height: 5 * scale, borderRadius: 5, background: '#7fe0ff' }),
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'Manrope',
          fontWeight: 700,
          fontSize: 10.5 * scale,
          letterSpacing: 0.6,
          color: '#ffffff',
        },
        label.toUpperCase(),
      ),
    ],
  );
}

function dotAccent(scale: number, color: string): SatoriNode {
  return el(
    'div',
    { display: 'flex', flexDirection: 'column', gap: 8 * scale },
    Array.from({ length: 3 }, () =>
      el(
        'div',
        { display: 'flex', gap: 8 * scale },
        Array.from({ length: 4 }, () =>
          el('div', { display: 'flex', width: 4 * scale, height: 4 * scale, borderRadius: 4, background: color }),
        ),
      ),
    ),
  );
}

// ---- "quote" layout: pure typography, no hero photo ----

function buildQuoteSquareTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  whiteLogoDataUri: string,
): SatoriNode {
  const scale = width / 1080;
  const contentWidth = width - 112 * scale;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width,
      height,
      padding: 56 * scale,
      background: `linear-gradient(160deg, ${HOUSE.darkSoft} 0%, ${HOUSE.dark} 100%)`,
      fontFamily: 'Manrope',
    },
    [
      el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
        { type: 'img', props: { src: whiteLogoDataUri, width: 120 * scale, height: 120 * scale, style: { objectFit: 'contain' } } },
        dotAccent(scale, 'rgba(127,224,255,0.5)'),
      ]),
      el('div', { display: 'flex', flex: 1 }),
      el('div', { display: 'flex', flexDirection: 'column', width: contentWidth, gap: 18 * scale }, [
        lightEyebrowPill(theme.label, scale * 1.1),
        el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Manrope',
            fontWeight: 800,
            fontSize: 58 * scale,
            lineHeight: 1.08,
            letterSpacing: -0.6 * scale,
            color: '#ffffff',
          },
          content.headline.map((line) => el('div', { display: 'flex' }, line)),
        ),
        el('div', {
          display: 'flex',
          width: 56 * scale,
          height: 4 * scale,
          borderRadius: 2,
          background: '#5b8dff',
        }),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 500,
            fontSize: 16 * scale,
            lineHeight: 1.5,
            color: '#93a4bd',
            maxWidth: contentWidth * 0.85,
          },
          content.subheadline,
        ),
      ]),
      el('div', { display: 'flex', flex: 1 }),
      lightSlimFooterRow(contentWidth, scale),
    ],
  );
}

function buildQuoteLandscapeTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  whiteLogoDataUri: string,
): SatoriNode {
  const scale = height / 627;
  const contentWidth = width - 160 * scale;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width,
      height,
      padding: 48 * scale,
      background: `linear-gradient(160deg, ${HOUSE.darkSoft} 0%, ${HOUSE.dark} 100%)`,
      fontFamily: 'Manrope',
    },
    [
      el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
        { type: 'img', props: { src: whiteLogoDataUri, width: 100 * scale, height: 100 * scale, style: { objectFit: 'contain' } } },
        dotAccent(scale, 'rgba(127,224,255,0.5)'),
      ]),
      el('div', { display: 'flex', flex: 1 }),
      el('div', { display: 'flex', flexDirection: 'column', width: contentWidth, gap: 14 * scale }, [
        lightEyebrowPill(theme.label, scale),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 800,
            fontSize: 44 * scale,
            lineHeight: 1.1,
            letterSpacing: -0.5 * scale,
            color: '#ffffff',
          },
          content.headline.join(' '),
        ),
        el('div', {
          display: 'flex',
          width: 50 * scale,
          height: 3.5 * scale,
          borderRadius: 2,
          background: '#5b8dff',
        }),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 500,
            fontSize: 14 * scale,
            lineHeight: 1.5,
            color: '#93a4bd',
            maxWidth: contentWidth * 0.7,
          },
          content.subheadline,
        ),
      ]),
      el('div', { display: 'flex', flex: 1 }),
      lightSlimFooterRow(contentWidth, scale),
    ],
  );
}

// ---- "split" layout: hero image full-bleed on one side, text flush on the other ----

function buildSplitSquareTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  heroArtDataUri: string,
  logoDataUri: string,
): SatoriNode {
  const scale = width / 1080;
  const imageHeight = height * 0.48;
  const contentWidth = width - 96 * scale;

  return el(
    'div',
    { display: 'flex', flexDirection: 'column', width, height, background: HOUSE.bg, fontFamily: 'Manrope' },
    [
      {
        type: 'img',
        props: { src: heroArtDataUri, width, height: imageHeight, style: { objectFit: 'cover' } },
      },
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: `${36 * scale}px ${48 * scale}px`,
          justifyContent: 'space-between',
        },
        [
          el('div', { display: 'flex', flexDirection: 'column', gap: 16 * scale }, [
            el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, [
              eyebrowPill(theme.label, scale),
              {
                type: 'img',
                props: { src: logoDataUri, width: 140 * scale, height: 140 * scale, style: { objectFit: 'contain' } },
              },
            ]),
            el('div', { display: 'flex', flexDirection: 'column', gap: 10 * scale }, [
              themedHeadline(content.headline, scale * 0.85),
              el(
                'div',
                {
                  display: 'flex',
                  fontFamily: 'Manrope',
                  fontWeight: 500,
                  fontSize: 14.5 * scale,
                  lineHeight: 1.45,
                  color: HOUSE.inkDim,
                  maxWidth: contentWidth * 0.92,
                },
                content.subheadline,
              ),
            ]),
          ]),
          slimFooterRow(contentWidth, scale),
        ],
      ),
    ],
  );
}

function buildSplitLandscapeTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  heroArtDataUri: string,
  logoDataUri: string,
): SatoriNode {
  const scale = height / 627;
  const imageWidth = width * 0.42;
  const rightWidth = width - imageWidth;

  return el(
    'div',
    { display: 'flex', width, height, background: HOUSE.bg, fontFamily: 'Manrope' },
    [
      {
        type: 'img',
        props: { src: heroArtDataUri, width: imageWidth, height, style: { objectFit: 'cover' } },
      },
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          width: rightWidth,
          height: '100%',
          padding: `${36 * scale}px ${40 * scale}px`,
        },
        [
          el('div', { display: 'flex', flexDirection: 'column', gap: 20 * scale }, [
            {
              type: 'img',
              props: { src: logoDataUri, width: 200 * scale, height: 72 * scale, style: { objectFit: 'contain' } },
            },
            el('div', { display: 'flex', flexDirection: 'column', gap: 12 * scale }, [
              eyebrowPill(theme.label, scale),
              themedHeadline(content.headline, scale * 0.72),
              el(
                'div',
                {
                  display: 'flex',
                  fontFamily: 'Manrope',
                  fontWeight: 500,
                  fontSize: 13 * scale,
                  lineHeight: 1.4,
                  color: HOUSE.inkDim,
                },
                content.subheadline,
              ),
            ]),
          ]),
          el('div', { display: 'flex', flex: 1 }),
          slimFooterRow(rightWidth - 80 * scale, scale * 0.92),
        ],
      ),
    ],
  );
}

// ---- "full-bleed" layout: hero image fills the entire canvas, text overlaid on a bottom scrim ----

function buildFullBleedSquareTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  heroArtDataUri: string,
  whiteLogoDataUri: string,
): SatoriNode {
  const scale = width / 1080;
  const contentWidth = width - 96 * scale;

  return el(
    'div',
    { display: 'flex', position: 'relative', width, height, fontFamily: 'Manrope' },
    [
      { type: 'img', props: { src: heroArtDataUri, width, height, style: { objectFit: 'cover' } } },
      el('div', {
        display: 'flex',
        position: 'absolute',
        left: 0,
        top: 0,
        width: 96 * scale,
        height: 96 * scale,
        margin: 40 * scale,
        borderRadius: 16 * scale,
        background: 'rgba(6,9,17,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
      }, [
        { type: 'img', props: { src: whiteLogoDataUri, width: 60 * scale, height: 60 * scale, style: { objectFit: 'contain' } } },
      ]),
      el(
        'div',
        {
          display: 'flex',
          position: 'absolute',
          left: 0,
          bottom: 0,
          width,
          flexDirection: 'column',
          gap: 12 * scale,
          padding: `${64 * scale}px ${48 * scale}px ${40 * scale}px`,
          background: `linear-gradient(0deg, rgba(6,9,17,0.96) 0%, rgba(6,9,17,0.78) 55%, rgba(6,9,17,0) 100%)`,
        },
        [
          lightEyebrowPill(theme.label, scale),
          el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'Manrope',
              fontWeight: 800,
              fontSize: 38 * scale,
              lineHeight: 1.1,
              letterSpacing: -0.4 * scale,
              color: '#ffffff',
            },
            content.headline.map((line) => el('div', { display: 'flex' }, line)),
          ),
          el(
            'div',
            {
              display: 'flex',
              fontFamily: 'Manrope',
              fontWeight: 500,
              fontSize: 13.5 * scale,
              lineHeight: 1.45,
              color: '#c3cede',
              maxWidth: contentWidth * 0.9,
            },
            content.subheadline,
          ),
          el('div', { display: 'flex', marginTop: 10 * scale }, [lightSlimFooterRow(contentWidth, scale)]),
        ],
      ),
    ],
  );
}

function buildFullBleedLandscapeTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  heroArtDataUri: string,
  whiteLogoDataUri: string,
): SatoriNode {
  const scale = height / 627;
  const contentWidth = width * 0.56;

  return el(
    'div',
    { display: 'flex', position: 'relative', width, height, fontFamily: 'Manrope' },
    [
      { type: 'img', props: { src: heroArtDataUri, width, height, style: { objectFit: 'cover' } } },
      el('div', {
        display: 'flex',
        position: 'absolute',
        left: 0,
        top: 0,
        width: 80 * scale,
        height: 80 * scale,
        margin: 32 * scale,
        borderRadius: 14 * scale,
        background: 'rgba(6,9,17,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
      }, [
        { type: 'img', props: { src: whiteLogoDataUri, width: 52 * scale, height: 52 * scale, style: { objectFit: 'contain' } } },
      ]),
      el(
        'div',
        {
          display: 'flex',
          position: 'absolute',
          left: 0,
          bottom: 0,
          width,
          flexDirection: 'column',
          gap: 10 * scale,
          padding: `${48 * scale}px ${44 * scale}px ${32 * scale}px`,
          background: `linear-gradient(0deg, rgba(6,9,17,0.94) 0%, rgba(6,9,17,0.7) 60%, rgba(6,9,17,0) 100%)`,
        },
        [
          lightEyebrowPill(theme.label, scale),
          el(
            'div',
            {
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'Manrope',
              fontWeight: 800,
              fontSize: 32 * scale,
              lineHeight: 1.1,
              letterSpacing: -0.4 * scale,
              color: '#ffffff',
              maxWidth: contentWidth,
            },
            content.headline.map((line) => el('div', { display: 'flex' }, line)),
          ),
          el(
            'div',
            {
              display: 'flex',
              fontFamily: 'Manrope',
              fontWeight: 500,
              fontSize: 12.5 * scale,
              lineHeight: 1.4,
              color: '#c3cede',
              maxWidth: contentWidth,
            },
            content.subheadline,
          ),
          el('div', { display: 'flex', marginTop: 8 * scale }, [lightSlimFooterRow(width - 88 * scale, scale * 0.92)]),
        ],
      ),
    ],
  );
}

function buildThemedSquareTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  heroArtDataUri: string,
  logoDataUri: string,
): SatoriNode {
  const scale = width / 1080;
  const contentWidth = width - 96 * scale;

  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width,
      height,
      padding: 48 * scale,
      gap: 16 * scale,
      background: HOUSE.bg,
      fontFamily: 'Manrope',
    },
    [
      el('div', { display: 'flex', justifyContent: 'center', width: contentWidth }, [
        {
          type: 'img',
          props: { src: logoDataUri, width: 192 * scale, height: 192 * scale, style: { objectFit: 'contain' } },
        },
      ]),
      eyebrowPill(theme.label, scale),
      el('div', { display: 'flex', flexDirection: 'column', gap: 10 * scale }, [
        themedHeadline(content.headline, scale),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Manrope',
            fontWeight: 500,
            fontSize: 15 * scale,
            lineHeight: 1.45,
            color: HOUSE.inkDim,
            maxWidth: contentWidth * 0.92,
          },
          content.subheadline,
        ),
      ]),
      el(
        'div',
        {
          display: 'flex',
          width: contentWidth,
          flex: 1,
          borderRadius: 22 * scale,
          overflow: 'hidden',
          background: HOUSE.dark,
        },
        [
          {
            type: 'img',
            props: {
              src: heroArtDataUri,
              width: contentWidth,
              height: '100%',
              style: { objectFit: 'cover' },
            },
          },
        ],
      ),
      slimFooterRow(contentWidth, scale),
    ],
  );
}

function buildThemedLandscapeTree(
  content: ThemedPostPayload,
  theme: ContentTheme,
  width: number,
  height: number,
  heroArtDataUri: string,
  logoDataUri: string,
): SatoriNode {
  const scale = height / 627;
  const leftWidth = width * 0.5;
  const rightWidth = width * 0.44;

  return el(
    'div',
    {
      display: 'flex',
      width,
      height,
      padding: 40 * scale,
      gap: 32 * scale,
      background: HOUSE.bg,
      fontFamily: 'Manrope',
    },
    [
      el(
        'div',
        { display: 'flex', flexDirection: 'column', width: leftWidth, height: '100%' },
        [
          {
            type: 'img',
            props: { src: logoDataUri, width: 240 * scale, height: 84 * scale, style: { objectFit: 'contain' } },
          },
          el('div', { display: 'flex', flex: 1 }),
          el('div', { display: 'flex', flexDirection: 'column', gap: 18 * scale }, [
            eyebrowPill(theme.label, scale),
            el('div', { display: 'flex', flexDirection: 'column', gap: 10 * scale }, [
              themedHeadline(content.headline, scale * 0.9),
              el(
                'div',
                {
                  display: 'flex',
                  fontFamily: 'Manrope',
                  fontWeight: 500,
                  fontSize: 14 * scale,
                  lineHeight: 1.4,
                  color: HOUSE.inkDim,
                },
                content.subheadline,
              ),
            ]),
          ]),
          el('div', { display: 'flex', flex: 1 }),
          slimFooterRow(leftWidth, scale * 0.95),
        ],
      ),
      el(
        'div',
        {
          display: 'flex',
          width: rightWidth,
          height: '100%',
          borderRadius: 18 * scale,
          overflow: 'hidden',
          background: HOUSE.dark,
        },
        [
          {
            type: 'img',
            props: {
              src: heroArtDataUri,
              width: rightWidth,
              height: '100%',
              style: { objectFit: 'cover' },
            },
          },
        ],
      ),
    ],
  );
}

/** Sniffs magic bytes so hero art data URIs get the right MIME type - OpenAI always returns PNG, but Pexels returns JPEG. */
function detectImageMimeType(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return 'image/png';
}

export class TemplateService {
  private readonly fonts: {
    name: string;
    data: Buffer;
    weight: 400 | 500 | 600 | 700 | 800;
    style: 'normal';
  }[];
  private readonly logoDataUri: string;
  private readonly whiteLogoDataUri: string;

  constructor() {
    this.fonts = [
      { name: 'Manrope', data: fs.readFileSync(path.join(FONTS_DIR, 'Manrope-Regular.woff')), weight: 400, style: 'normal' },
      { name: 'Manrope', data: fs.readFileSync(path.join(FONTS_DIR, 'Manrope-SemiBold.woff')), weight: 600, style: 'normal' },
      { name: 'Manrope', data: fs.readFileSync(path.join(FONTS_DIR, 'Manrope-ExtraBold.woff')), weight: 800, style: 'normal' },
      { name: 'JetBrains Mono', data: fs.readFileSync(path.join(FONTS_DIR, 'JetBrainsMono-Medium.woff')), weight: 500, style: 'normal' },
    ];
    this.logoDataUri = `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
    this.whiteLogoDataUri = `data:image/png;base64,${fs.readFileSync(LOGO_WHITE_PATH).toString('base64')}`;
  }

  async renderServiceCard(
    topic: ServiceTopic,
    platform: Platform,
    heroImageBuffer?: Buffer,
  ): Promise<Buffer> {
    const { width, height } = IMAGE_DIMENSIONS[platform];
    const heroImageDataUri = heroImageBuffer
      ? `data:image/png;base64,${heroImageBuffer.toString('base64')}`
      : undefined;
    const tree =
      platform === 'instagram'
        ? buildSquareTree(topic, width, height, heroImageDataUri)
        : buildLandscapeTree(topic, width, height, heroImageDataUri);

    const svgMarkup = await satori(tree as never, { width, height, fonts: this.fonts });
    const resvg = new Resvg(svgMarkup, { fitTo: { mode: 'width', value: width } });
    return resvg.render().asPng();
  }

  async renderHouseStyleCard(
    topic: ServiceTopic,
    platform: Platform,
    heroArtBuffer: Buffer,
  ): Promise<Buffer> {
    const { width, height } = IMAGE_DIMENSIONS[platform];
    const heroArtDataUri = `data:${detectImageMimeType(heroArtBuffer)};base64,${heroArtBuffer.toString('base64')}`;
    const tree =
      platform === 'instagram'
        ? buildHouseStyleSquareTree(topic, width, height, heroArtDataUri, this.logoDataUri)
        : buildHouseStyleLandscapeTree(topic, width, height, heroArtDataUri, this.logoDataUri);

    const svgMarkup = await satori(tree as never, { width, height, fonts: this.fonts });
    const resvg = new Resvg(svgMarkup, { fitTo: { mode: 'width', value: width } });
    return resvg.render().asPng();
  }

  async renderThemedPost(
    content: ThemedPostPayload,
    theme: ContentTheme,
    platform: Platform,
    heroArtBuffer: Buffer,
    layout: LayoutId = 'editorial',
  ): Promise<Buffer> {
    const { width, height } = IMAGE_DIMENSIONS[platform];
    const heroArtDataUri = `data:${detectImageMimeType(heroArtBuffer)};base64,${heroArtBuffer.toString('base64')}`;
    const isSquare = platform === 'instagram';

    const tree = ((): SatoriNode => {
      switch (layout) {
        case 'quote':
          return isSquare
            ? buildQuoteSquareTree(content, theme, width, height, this.whiteLogoDataUri)
            : buildQuoteLandscapeTree(content, theme, width, height, this.whiteLogoDataUri);
        case 'split':
          return isSquare
            ? buildSplitSquareTree(content, theme, width, height, heroArtDataUri, this.logoDataUri)
            : buildSplitLandscapeTree(content, theme, width, height, heroArtDataUri, this.logoDataUri);
        case 'full-bleed':
          return isSquare
            ? buildFullBleedSquareTree(content, theme, width, height, heroArtDataUri, this.whiteLogoDataUri)
            : buildFullBleedLandscapeTree(content, theme, width, height, heroArtDataUri, this.whiteLogoDataUri);
        case 'editorial':
        default:
          return isSquare
            ? buildThemedSquareTree(content, theme, width, height, heroArtDataUri, this.logoDataUri)
            : buildThemedLandscapeTree(content, theme, width, height, heroArtDataUri, this.logoDataUri);
      }
    })();

    const svgMarkup = await satori(tree as never, { width, height, fonts: this.fonts });
    const resvg = new Resvg(svgMarkup, { fitTo: { mode: 'width', value: width } });
    return resvg.render().asPng();
  }

  async renderImpactCard(data: ImpactCardData): Promise<Buffer> {
    const { width, height } = IMAGE_DIMENSIONS.instagram;
    const tree = buildImpactSquareTree(data, width, height);

    const svgMarkup = await satori(tree as never, { width, height, fonts: this.fonts });
    const resvg = new Resvg(svgMarkup, { fitTo: { mode: 'width', value: width } });
    return resvg.render().asPng();
  }
}
