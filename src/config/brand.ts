export const BRAND = {
  name: 'Alphazox',
  tagline: 'Digital Transformation Partner',
  website: 'www.alphazox.com',
  supportEmail: 'support@alphazox.com',
};

/**
 * Shared by every post prompt. The model kept inventing Alphazox history
 * ("we embedded privacy checks and cut weeks off delivery", "our flagship
 * platform", "clients report...") - the client wants Alphazox's *approach*
 * to a problem described instead, never claimed past work or results.
 * "We"/"our" are fine when they describe how Alphazox works.
 */
export const APPROACH_NOT_CLAIMS_RULE = `How to talk about ALPHAZOX (strict):
- Never claim ALPHAZOX has already done, built, shipped, chosen, or achieved something. No past-tense
  stories ("we embedded...", "we chose...", "our team migrated..."), no results or timelines ("cut weeks
  off delivery", "reduced costs by..."), no named products or platforms ("our flagship platform"), and no
  client outcomes or testimonials ("clients report...").
- Instead, describe the APPROACH ALPHAZOX follows to solve a problem, as method, not history: "When
  privacy reviews slow AI delivery, the approach we follow is to build privacy checks into the CI/CD
  pipeline so every model is checked before it reaches staging." Frame it as "if a company faces X,
  this is how we solve it" and give the concrete steps.
- "We" and "our" are fine when they describe how ALPHAZOX works or would work.`;

/**
 * Per-platform feed image dimensions, so the same visual concept renders
 * without awkward cropping on each network (LinkedIn's 1.91:1 feed ratio,
 * Twitter's 16:9 in-feed ratio, Instagram's 1:1 square).
 */
export const IMAGE_DIMENSIONS = {
  linkedin: { width: 1200, height: 627 },
  twitter: { width: 1200, height: 675 },
  // 4:5 - Instagram's recommended portrait feed ratio (more vertical space
  // than 1:1, no cropping in-feed), see [[content_theme_pipeline]].
  instagram: { width: 1080, height: 1350 },
} as const;

export interface ServiceTopic {
  name: string;
  tagline: string;
  capabilities: string[];
}

/**
 * Alphazox's 10 service lines, sourced directly from their own marketing
 * graphics. Content generation rotates through these round-robin (see
 * PostRepository.getNextTopic) so consecutive posts never cover the same
 * service twice in a row.
 */
export const SERVICE_TOPICS: ServiceTopic[] = [
  {
    name: 'Cloud Native Solutions',
    tagline: 'Build once. Scale anywhere.',
    capabilities: [
      'Cloud Native Apps',
      'Microservices',
      'Containers & Kubernetes',
      'DevSecOps',
      'Scalability & Resilience',
    ],
  },
  {
    name: 'AI Model Development',
    tagline: 'Smarter models. Better outcomes.',
    capabilities: [
      'Custom AI Models',
      'Model Training',
      'Fine-Tuning',
      'NLP / Computer Vision',
      'MLOps & Deployment',
    ],
  },
  {
    name: 'Enterprise Solutions',
    tagline: 'Tailored solutions for modern enterprises.',
    capabilities: [
      'Business Process Automation',
      'Workflow Management',
      'Integration Services',
      'Data Management',
      'Enterprise Support',
    ],
  },
  {
    name: 'Data Engineering',
    tagline: 'Clean data. Strong pipelines. Better decisions.',
    capabilities: [
      'Data Pipelines',
      'ETL / ELT Processes',
      'Data Warehousing',
      'Real-time Streaming',
      'Data Quality',
    ],
  },
  {
    name: 'Quality Assurance',
    tagline: 'Delivering bug-free digital experiences.',
    capabilities: [
      'Manual Testing',
      'Automation Testing',
      'Performance Testing',
      'Security Testing',
      'Test Consulting',
    ],
  },
  {
    name: 'Product Design',
    tagline: 'Great design is great business.',
    capabilities: ['User Research', 'Wireframing', 'Prototyping', 'UI/UX Design', 'Design Systems'],
  },
  {
    name: 'Mobile App Maintenance',
    tagline: 'We build. We support. We evolve.',
    capabilities: [
      'App Support',
      'Bug Fixing',
      'Performance Optimization',
      'Feature Updates',
      '24/7 Monitoring',
    ],
  },
  {
    name: 'Cyber Security',
    tagline: 'Protect. Detect. Respond. Stay ahead.',
    capabilities: [
      'Threat Detection',
      'Vulnerability Assessment',
      'Security Audit',
      'Incident Response',
      'Compliance & Governance',
    ],
  },
  {
    name: 'IT Infrastructure',
    tagline: 'Reliable infrastructure. Stronger business.',
    capabilities: [
      'Server Management',
      'Network Management',
      'Infrastructure Monitoring',
      'Backup & Disaster Recovery',
      'IT Help Desk',
    ],
  },
  {
    name: 'Emerging Technologies',
    tagline: 'Exploring today. Powering tomorrow.',
    capabilities: [
      'Blockchain',
      'Internet of Things (IoT)',
      'Augmented Reality (AR)',
      'Virtual Reality (VR)',
      'Edge Computing',
    ],
  },
];
