import type { NewsBeat } from '../services/news-research.service.js';

export { AI_TECH_BEAT } from '../services/news-research.service.js';

export const HEALTHCARE_BEAT: NewsBeat = {
  id: 'healthcare',
  topicSummary:
    'healthcare technology, electronic health records (EHR/EMR) and interoperability, telemedicine and virtual ' +
    'care, healthcare AI and clinical decision support, hospital and health-system IT, health data security and ' +
    'HIPAA compliance, digital health funding and healthtech startups',
  gnewsQuery:
    '(EHR OR "electronic health record" OR "health IT" OR telemedicine OR "digital health" OR "healthcare AI" ' +
    'OR healthtech OR "health data")',
  categoryIds: ['healthcare-it'],
  defaultCategory: 'healthcare-it',
};

export const INDUSTRY_INSIGHTS_BEAT: NewsBeat = {
  id: 'industry-insights',
  topicSummary:
    'how AI, cloud, automation and data technology are transforming specific industries - finance/fintech, ' +
    'retail, manufacturing/industry 4.0, logistics/supply chain, insurance/insurtech, real estate/proptech, ' +
    'energy, education',
  gnewsQuery:
    '("digital transformation" OR "industry 4.0" OR fintech OR retailtech OR "supply chain technology" ' +
    'OR "manufacturing automation" OR insurtech OR proptech)',
  categoryIds: ['industry-tech'],
  defaultCategory: 'industry-tech',
};
