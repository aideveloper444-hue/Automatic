import fs from 'node:fs';
import { TemplateService } from '../src/services/template.service.js';
import { DEFAULT_IMPACT_CARD } from '../src/config/impact-content.js';

const OUT_PATH = process.argv[2];
if (!OUT_PATH) {
  throw new Error('usage: tsx scripts/render-impact-sample.ts <outPath.png>');
}

const service = new TemplateService();
const buffer = await service.renderImpactCard(DEFAULT_IMPACT_CARD);
fs.writeFileSync(OUT_PATH, buffer);
console.log(`rendered impact card -> ${OUT_PATH}`);
