/**
 * Visual direction per news category, keyed to whatever category the
 * research step (see news-research.service.ts) classifies a story into.
 * Deliberately shaped like ContentTheme (id/label/visualHint/imageKeywords)
 * so the existing image pipeline - OpenAiService.generateThemedSceneArt(),
 * PexelsService.searchPhoto(), TemplateService.renderThemedPost() - can be
 * reused unchanged for news posts; only `guidance` is unused by that path.
 */
export interface NewsCategoryVisual {
  id: string;
  label: string;
  visualHint: string;
  imageKeywords: string[];
}

export const NEWS_CATEGORIES: Record<string, NewsCategoryVisual> = {
  ai: {
    id: 'ai',
    label: 'AI News',
    visualHint: 'abstract neural network or modern AI interface concept, clean and premium, not sci-fi cliche',
    imageKeywords: ['artificial intelligence technology', 'person using AI laptop', 'machine learning data'],
  },
  'ai-infrastructure': {
    id: 'ai-infrastructure',
    label: 'AI Infrastructure',
    visualHint: 'AI chips, GPUs, or data-center hardware, clean isometric or macro photography style',
    imageKeywords: ['data center server room', 'gpu chip technology', 'semiconductor manufacturing'],
  },
  cloud: {
    id: 'cloud',
    label: 'Cloud & Data Centers',
    visualHint: 'cloud infrastructure or data-center concept, clean isometric or diagrammatic style',
    imageKeywords: ['cloud computing server', 'data center technology', 'engineer server room'],
  },
  cybersecurity: {
    id: 'cybersecurity',
    label: 'Cybersecurity',
    visualHint: 'security-themed visual (lock, shield, verification) - defensive framing, not "hacker" imagery',
    imageKeywords: ['cybersecurity lock laptop', 'data protection technology', 'person secure login phone'],
  },
  'software-devtools': {
    id: 'software-devtools',
    label: 'Software & DevOps',
    visualHint: 'developer/DevOps-adjacent visual, clean and modern, not a literal code screenshot',
    imageKeywords: ['developer coding laptop', 'programmer desk multiple monitors', 'devops team screens'],
  },
  'enterprise-it': {
    id: 'enterprise-it',
    label: 'Enterprise IT',
    visualHint: 'professional business/technology setting, photorealistic',
    imageKeywords: ['business team meeting technology', 'professional office collaboration', 'business analytics dashboard'],
  },
  quantum: {
    id: 'quantum',
    label: 'Quantum Computing',
    visualHint: 'forward-looking but grounded quantum computing visual, not fantastical',
    imageKeywords: ['quantum computer lab', 'futuristic research lab', 'advanced computing hardware'],
  },
  markets: {
    id: 'markets',
    label: 'Tech Markets',
    visualHint: 'financial markets / trading-floor adjacent visual, professional and grounded',
    imageKeywords: ['stock market screens', 'finance team analyzing charts', 'trading floor technology'],
  },
  'big-tech': {
    id: 'big-tech',
    label: 'Big Tech',
    visualHint: 'modern corporate technology office setting, photorealistic',
    imageKeywords: ['modern tech office', 'corporate technology campus', 'professional office collaboration'],
  },
};

export const DEFAULT_NEWS_CATEGORY = 'enterprise-it';

export function resolveNewsCategory(category: string | undefined | null): NewsCategoryVisual {
  if (category && NEWS_CATEGORIES[category]) {
    return NEWS_CATEGORIES[category];
  }
  return NEWS_CATEGORIES[DEFAULT_NEWS_CATEGORY]!;
}
