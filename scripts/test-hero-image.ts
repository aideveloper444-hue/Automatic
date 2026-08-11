import fs from 'node:fs';
import { OpenAiService } from '../src/services/openai.service.js';
import { TemplateService } from '../src/services/template.service.js';
import { SERVICE_TOPICS } from '../src/config/brand.js';
import { appLogger } from '../src/config/logger.js';

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  throw new Error('usage: tsx scripts/test-hero-image.ts <outDir>');
}

const topic = SERVICE_TOPICS.find((t) => t.name === 'AI Model Development')!;

appLogger.info('Requesting hero image from OpenAI...');
const heroImageBuffer = await new OpenAiService().generateImage(topic);
fs.writeFileSync(`${OUT_DIR}/hero-raw.png`, heroImageBuffer);
appLogger.info('Saved raw hero image', { bytes: heroImageBuffer.length });

const templateService = new TemplateService();
for (const platform of ['instagram', 'linkedin', 'twitter'] as const) {
  const card = await templateService.renderServiceCard(topic, platform, heroImageBuffer);
  fs.writeFileSync(`${OUT_DIR}/card-${platform}.png`, card);
  appLogger.info(`Rendered ${platform} card`);
}
