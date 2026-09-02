/**
 * Content theme taxonomy so posts stop being one long "we build solutions"
 * ad rotated through daypart angles, and instead read as a technology
 * publication: facts, tips, myths, comparisons, occasionally Alphazox
 * itself. See PostRepository.getNextTheme for the no-repeat rotation and
 * GeminiService.generateThemedPost for how these drive the prompt.
 */
export interface ContentTheme {
  id: string;
  label: string;
  /** Relative pick frequency - brand-story stays rare so the feed doesn't drift back into ad copy. */
  weight: number;
  /** Content instructions inserted into the Gemini prompt. */
  guidance: string;
  /** Short visual-direction hint for the image prompt (see openai.service.ts buildThemedSceneArtPrompt). */
  visualHint: string;
  /** Stock-photo search terms (see pexels.service.ts) - a few variants so the same theme doesn't always pull the same photo. */
  imageKeywords: string[];
}

export const CONTENT_THEMES: ContentTheme[] = [
  {
    id: 'technical-fact',
    label: 'Technical Fact',
    weight: 2,
    guidance:
      'Explain one specific technical mechanism in plain language (e.g. how HTTPS protects users, what happens when you type a URL, how DNS resolves, why databases use indexes, how APIs communicate). Teach one real mechanism accurately.',
    visualHint: 'clean technical diagram or step-flow visual explaining the mechanism, minimal labels',
    imageKeywords: ['programmer typing code', 'server room technology', 'network cables data center'],
  },
  {
    id: 'did-you-know',
    label: 'Did You Know?',
    weight: 2,
    guidance:
      'Share one surprising, true, well-known technology fact or piece of tech history. Keep it verifiably accurate - do not invent or approximate statistics.',
    visualHint: 'a single striking visual metaphor for the surprising fact',
    imageKeywords: ['vintage computer technology', 'person amazed by laptop', 'retro tech history'],
  },
  {
    id: 'myth-vs-fact',
    label: 'Myth vs Fact',
    weight: 2,
    guidance:
      'Pick one common technology misconception. State the MYTH in one short line, then the FACT that corrects it in one short line.',
    visualHint: 'split-screen composition, left side visually representing the myth, right side the fact',
    imageKeywords: ['confused person laptop', 'business person thinking decision', 'team discussion whiteboard'],
  },
  {
    id: 'ai-fact',
    label: 'AI Fact',
    weight: 2,
    guidance: 'Explain one interesting, accurate AI/ML concept simply, without hype or overstated claims.',
    visualHint: 'abstract neural network or model concept, clean and modern, not sci-fi cliche',
    imageKeywords: ['artificial intelligence technology', 'person using AI laptop', 'machine learning data'],
  },
  {
    id: 'cybersecurity-awareness',
    label: 'Cybersecurity Awareness',
    weight: 2,
    guidance:
      'Cover one defensive cybersecurity awareness topic (phishing, password hygiene, MFA, zero trust, social engineering, data breach prevention). Educational and defensive only - never include exploit steps, attack instructions, or how-to-hack content.',
    visualHint: 'security-themed visual (lock, shield, verification) - defensive framing, not "hacker" imagery',
    imageKeywords: ['cybersecurity lock laptop', 'data protection technology', 'person secure login phone'],
  },
  {
    id: 'cloud-fact',
    label: 'Cloud Fact',
    weight: 1,
    guidance:
      'Explain one cloud computing concept simply (containers, serverless, load balancing, auto-scaling, cloud storage, disaster recovery).',
    visualHint: 'cloud infrastructure concept, clean isometric or diagrammatic style',
    imageKeywords: ['cloud computing server', 'data center technology', 'engineer server room'],
  },
  {
    id: 'web-dev-tip',
    label: 'Web Development Tip',
    weight: 1,
    guidance:
      'Share one actionable web development tip (performance, responsive design, accessibility, SEO basics, API security, frontend performance).',
    visualHint: 'browser/code-adjacent visual, clean and modern, not a literal code screenshot',
    imageKeywords: ['web developer coding laptop', 'programmer desk multiple monitors', 'developer working office'],
  },
  {
    id: 'mobile-app-tip',
    label: 'Mobile App Tip',
    weight: 1,
    guidance:
      'Share one actionable mobile app tip (performance, push notifications, UX, offline support, mobile security).',
    visualHint: 'mobile device in a real-world context relevant to the tip',
    imageKeywords: ['person using smartphone app', 'mobile app development', 'hand holding phone technology'],
  },
  {
    id: 'ui-ux-tip',
    label: 'UI/UX Tip',
    weight: 1,
    guidance:
      'Share one actionable UI/UX design tip (button placement, typography, color contrast, onboarding, forms, accessibility).',
    visualHint: 'clean interface/design-adjacent visual illustrating the principle',
    imageKeywords: ['designer sketching wireframe', 'ux design team meeting', 'designer working tablet'],
  },
  {
    id: 'business-tech',
    label: 'Business + Technology',
    weight: 1,
    guidance:
      'Explain how a specific technology practice affects a business outcome (productivity, customer experience, automation, data-driven decisions, operations).',
    visualHint: 'professional business/technology setting, photorealistic',
    imageKeywords: ['business team meeting technology', 'professional office collaboration', 'business analytics dashboard'],
  },
  {
    id: 'tech-trend',
    label: 'Technology Trend',
    weight: 1,
    guidance: 'Explain one current, real technology trend in accessible language - no hype, no invented statistics.',
    visualHint: 'forward-looking but grounded technology visual, not generic sci-fi',
    imageKeywords: ['modern technology office', 'futuristic interface screen', 'innovation team technology'],
  },
  {
    id: 'comparison',
    label: 'Comparison',
    weight: 2,
    guidance:
      'Compare two real technology approaches (monolith vs microservices, SQL vs NoSQL, REST vs GraphQL, cloud vs on-premise, native vs cross-platform, authentication vs authorization). Fair, accurate, non-dismissive of either side.',
    visualHint: 'side-by-side split composition contrasting the two concepts',
    imageKeywords: ['team comparing options whiteboard', 'two paths decision technology', 'engineers discussing architecture'],
  },
  {
    id: 'quick-tip',
    label: 'Quick Tip',
    weight: 2,
    guidance: 'One useful, concrete technology tip understandable in five to ten seconds. No fluff.',
    visualHint: 'single clear visual metaphor, very minimal',
    imageKeywords: ['laptop desk minimal workspace', 'close up keyboard typing', 'person working laptop cafe'],
  },
  {
    id: 'common-mistake',
    label: 'Common Mistake',
    weight: 1,
    guidance: 'Describe one common, real mistake businesses or developers make in a technology area, and the fix.',
    visualHint: 'before/after or warning-adjacent visual, not alarmist',
    imageKeywords: ['frustrated developer laptop', 'person reviewing mistake document', 'stressed office worker screen'],
  },
  {
    id: 'explained-simply',
    label: 'Technology Explained Simply',
    weight: 1,
    guidance: 'Take one complex technology concept and explain it the way you would to a curious beginner.',
    visualHint: 'approachable, friendly visual metaphor for the concept',
    imageKeywords: ['mentor teaching laptop', 'friendly team explaining whiteboard', 'person learning technology'],
  },
  {
    id: 'question-engagement',
    label: 'Question / Engagement',
    weight: 1,
    guidance: 'Ask one genuinely interesting, open-ended technology question that invites replies. No forced CTA.',
    visualHint: 'thought-provoking visual, contemplative mood',
    imageKeywords: ['person thinking looking screen', 'contemplative office window', 'thoughtful professional laptop'],
  },
  {
    id: 'future-tech',
    label: 'Future of Technology',
    weight: 1,
    guidance: 'Discuss one realistic, grounded near-future technology trend - avoid speculative hype.',
    visualHint: 'forward-looking but grounded and realistic, not fantastical',
    imageKeywords: ['modern office technology innovation', 'engineer robotics lab', 'futuristic workspace screens'],
  },
  {
    id: 'industry-insight',
    label: 'Industry Insight',
    weight: 1,
    guidance:
      'Explain how technology is changing one specific industry (healthcare, finance, retail, education, manufacturing, logistics, real estate).',
    visualHint: 'photorealistic scene grounded in that specific industry',
    imageKeywords: ['healthcare technology professional', 'finance team screens office', 'factory technology automation'],
  },
  {
    id: 'brand-story',
    label: 'Alphazox Brand Story',
    weight: 1,
    guidance:
      'Write about Alphazox itself and one of its service capabilities: what the service does and the concrete outcome it delivers for a client. This is the only theme that should read as promotional.',
    visualHint: 'professional team/technology visual relevant to the specific service',
    imageKeywords: ['tech team collaboration office', 'software team meeting laptops', 'professional developers office'],
  },
  {
    id: 'building-alphazox',
    label: 'Building Alphazox',
    weight: 1,
    guidance:
      "Write from Alphazox's own perspective about what it's actually like building an IT/AI company right now - a real lesson, decision, engineering challenge, or moment of progress. Human, honest, behind-the-scenes tone (not a case study, not a sales pitch) meant to build genuine connection with the audience, not to sell.",
    visualHint: 'authentic team-at-work visual (engineers collaborating, whiteboard session, small growing team) - warm and human, not corporate stock-photo generic',
    imageKeywords: ['startup team working together', 'engineers collaborating whiteboard', 'small tech team office'],
  },
];

export function getThemeById(id: string): ContentTheme {
  const theme = CONTENT_THEMES.find((t) => t.id === id);
  if (!theme) {
    throw new Error(`Unknown content theme id: ${id}`);
  }
  return theme;
}

/**
 * Excludes recently-used theme ids (see PostRepository.getRecentlyUsedThemeIds)
 * so a batch of several posts doesn't repeat a theme, not just avoid the
 * single immediately-preceding one. Falls back to the full list if the
 * exclusion would leave nothing to pick from.
 */
export function pickWeightedTheme(excludeIds: string[] = []): ContentTheme {
  const excludeSet = new Set(excludeIds);
  const filtered = CONTENT_THEMES.filter((t) => !excludeSet.has(t.id));
  const pool = filtered.length > 0 ? filtered : CONTENT_THEMES;
  const totalWeight = pool.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const theme of pool) {
    roll -= theme.weight;
    if (roll <= 0) {
      return theme;
    }
  }

  return pool[pool.length - 1]!;
}
