export const BRAND = {
  name: 'Alphazox',
  tagline: 'Digital Transformation Partner',
  website: 'www.alphazox.com',
  supportEmail: 'support@alphazox.com',
  // Visual style shared across Alphazox's own marketing graphics: dark
  // navy/near-black backgrounds, glowing cyan-blue accent lighting,
  // minimalist isometric 3D tech illustrations, glass/metallic textures,
  // professional enterprise SaaS aesthetic.
  imageStyle:
    'dark navy or near-black background, glowing cyan-blue neon accent lighting, minimalist isometric 3D tech illustration style, glass and brushed-metal textures, clean professional enterprise SaaS aesthetic, high-quality 3D render, no readable text or logos anywhere in the image',
};

/**
 * Per-platform feed image dimensions, so the same visual concept renders
 * without awkward cropping on each network (LinkedIn's 1.91:1 feed ratio,
 * Twitter's 16:9 in-feed ratio, Instagram's 1:1 square).
 */
export const IMAGE_DIMENSIONS = {
  linkedin: { width: 1200, height: 627 },
  twitter: { width: 1200, height: 675 },
  instagram: { width: 1080, height: 1080 },
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
