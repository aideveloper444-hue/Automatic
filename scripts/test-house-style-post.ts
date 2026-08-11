import fs from 'node:fs';
import { OpenAiService } from '../src/services/openai.service.js';
import { TemplateService } from '../src/services/template.service.js';
import { SERVICE_TOPICS } from '../src/config/brand.js';
import { appLogger } from '../src/config/logger.js';

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  throw new Error('usage: tsx scripts/test-house-style-post.ts <outDir>');
}

const topic = SERVICE_TOPICS.find((t) => t.name === 'Data Engineering')!;
const openAiService = new OpenAiService();
const templateService = new TemplateService();

appLogger.info('Requesting square scene art from OpenAI...');
const squareArt = await openAiService.generateSceneArt(topic, '1024x1024');
fs.writeFileSync(`${OUT_DIR}/scene-art-square.png`, squareArt);

appLogger.info('Requesting portrait scene art from OpenAI...');
const portraitArt = await openAiService.generateSceneArt(topic, '1024x1536');
fs.writeFileSync(`${OUT_DIR}/scene-art-portrait.png`, portraitArt);

for (const platform of ['instagram', 'linkedin', 'twitter'] as const) {
  const art = platform === 'instagram' ? squareArt : portraitArt;
  const card = await templateService.renderHouseStyleCard(topic, platform, art);
  fs.writeFileSync(`${OUT_DIR}/house-style-${platform}.png`, card);
  appLogger.info(`Rendered ${platform} house-style card`);
}
