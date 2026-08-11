import fs from 'node:fs';
import path from 'node:path';
import { TemplateService } from '../src/services/template.service.js';
import { SERVICE_TOPICS } from '../src/config/brand.js';

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  throw new Error('usage: tsx scripts/render-sample.ts <outDir>');
}

const service = new TemplateService();
const platforms = ['instagram', 'linkedin', 'twitter'] as const;

for (const topic of SERVICE_TOPICS) {
  const slug = topic.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  for (const platform of platforms) {
    const buffer = await service.renderServiceCard(topic, platform);
    const outPath = path.join(OUT_DIR, `${slug}__${platform}.png`);
    fs.writeFileSync(outPath, buffer);
  }
  console.log(`rendered ${topic.name}`);
}
