import fs from 'node:fs';
import { GeminiService } from '../src/services/gemini.service.js';
import { OpenAiService } from '../src/services/openai.service.js';
import { TemplateService } from '../src/services/template.service.js';
import { PostRepository } from '../src/repositories/post.repository.js';
import { CONTENT_THEMES, pickWeightedTheme } from '../src/config/content-themes.js';
import { LAYOUT_IDS, pickLayout } from '../src/config/layouts.js';
import type { LayoutId } from '../src/config/layouts.js';
import { appLogger } from '../src/config/logger.js';
import { PrismaClient } from '@prisma/client';

const THEME_ID = process.argv[2];
const LAYOUT_ARG = process.argv[3] as LayoutId | 'all' | undefined;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const postRepository = new PostRepository(prisma);
  const geminiService = new GeminiService(postRepository);
  const openAiService = new OpenAiService();
  const templateService = new TemplateService();

  try {
    await prisma.$connect();

    const theme = THEME_ID
      ? CONTENT_THEMES.find((t) => t.id === THEME_ID)!
      : pickWeightedTheme((await postRepository.getLastUsedThemeId()) ?? undefined);

    appLogger.info('test-themed-post: picked theme', { theme: theme.id });

    const post = await geminiService.generateThemedPost(theme);
    appLogger.info('test-themed-post: content generated', { headline: post.headline });

    const art = await openAiService.generateThemedSceneArt(theme, post.headline, post.subheadline, '1024x1536');

    const layouts: LayoutId[] =
      LAYOUT_ARG === 'all' ? [...LAYOUT_IDS] : LAYOUT_ARG ? [LAYOUT_ARG] : [pickLayout()];

    for (const layout of layouts) {
      for (const platform of ['instagram', 'linkedin', 'twitter'] as const) {
        const card = await templateService.renderThemedPost(post, theme, platform, art, layout);
        fs.writeFileSync(`e:/buffer/themed-${theme.id}-${layout}-${platform}.png`, card);
        appLogger.info(`Rendered ${layout}/${platform}`);
      }
    }

    console.log('\n--- Generated content ---');
    console.log(JSON.stringify(post, null, 2));
    console.log('--------------------------\n');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
