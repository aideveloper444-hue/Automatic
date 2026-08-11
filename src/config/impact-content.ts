export interface TextSpan {
  text: string;
  accent?: boolean;
}

export interface ImpactStat {
  icon: 'rocket' | 'chart' | 'shield' | 'people';
  value: string;
  label: string;
  description: string;
}

export interface ImpactCardData {
  headline: TextSpan[];
  subtext: TextSpan[];
  quoteLabel: string;
  quote: TextSpan[];
  attribution: string;
  stats: ImpactStat[];
  ctaText: string;
}

/** Default content mirrors Alphazox's existing "Real Impact" marketing graphic. */
export const DEFAULT_IMPACT_CARD: ImpactCardData = {
  headline: [
    { text: 'Real Challenges.' },
    { text: 'Real Impact.', accent: true },
    { text: 'Real Partnership.' },
  ],
  subtext: [
    { text: "We don't just deliver solutions, we build partnerships that create " },
    { text: 'measurable outcomes.', accent: true },
  ],
  quoteLabel: 'Client Success',
  quote: [
    { text: 'Alphazox understood our vision and turned it into a scalable solution that ' },
    { text: 'drives real impact.', accent: true },
  ],
  attribution: '— CTO, FinTech Company',
  stats: [
    {
      icon: 'rocket',
      value: '30%+',
      label: 'IMPROVEMENT',
      description: 'in operational efficiency',
    },
    { icon: 'chart', value: '2X', label: 'FASTER', description: 'time to market' },
    { icon: 'shield', value: '99.9%', label: 'SYSTEM', description: 'reliability achieved' },
    { icon: 'people', value: '100%', label: 'CLIENT', description: 'satisfaction focus' },
  ],
  ctaText: "Let's build solutions that create real impact.",
};
