import { buildContainer } from '../src/container.js';
import { appLogger } from '../src/config/logger.js';
import { isCloudinaryConfigured, isPexelsConfigured } from '../src/config/env.js';
import { pickWeightedTheme } from '../src/config/content-themes.js';
import { pickLayout } from '../src/config/layouts.js';
import type { ContentTheme } from '../src/config/content-themes.js';
import type { LayoutId } from '../src/config/layouts.js';
import type { ThemedPostPayload } from '../src/services/gemini.service.js';

async function generateHeroArt(
  deps: ReturnType<typeof buildContainer>,
  theme: ContentTheme,
  content: ThemedPostPayload,
): Promise<Buffer> {
  const { openAiService, pexelsService } = deps;

  try {
    return await openAiService.generateThemedSceneArt(theme, content.headline, content.subheadline, '1024x1536');
  } catch (error) {
    appLogger.warn('OpenAI art generation failed; falling back to Pexels', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!isPexelsConfigured) {
    throw new Error('OpenAI failed and Pexels is not configured; no hero art available');
  }

  return pexelsService.searchPhoto(theme.imageKeywords, 'portrait');
}

// Minutes from *actual call time* (not from process start) - computed fresh
// per platform inside schedulePlatform(), not pre-computed once in main().
// A single externally pre-computed HH:MM went stale when there was an
// unexpected ~11min gap between computing "now" and the script actually
// running, causing Buffer to reject the whole cycle with
// "dueAt must be in the future". Optional CLI arg overrides the default.
const OFFSET_MINUTES = process.argv[2] ? Number(process.argv[2]) : 5;

function buildScheduleDateString(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

async function schedulePlatform(
  deps: ReturnType<typeof buildContainer>,
  platform: 'linkedin' | 'twitter' | 'instagram',
  theme: ContentTheme,
  layout: LayoutId,
  content: ThemedPostPayload,
  heroArt: Buffer,
): Promise<void> {
  const { templateService, cloudinaryService, postRepository, bufferService, groqService } = deps;
  const dueAt = buildScheduleDateString(OFFSET_MINUTES);

  let text = `${content.caption}\n\n${content.hashtags}`;
  let captionForSave = content.caption;
  let hashtagsForSave = content.hashtags;

  if (platform === 'twitter') {
    const variant = await groqService.generateTwitterVariant(theme.label, content.caption);
    text = variant.hashtags ? `${variant.content} ${variant.hashtags}` : variant.content;
    captionForSave = variant.content;
    hashtagsForSave = variant.hashtags;
  }

  let imageUrl: string | undefined;
  if (isCloudinaryConfigured) {
    const imageBuffer = await templateService.renderThemedPost(content, theme, platform, heroArt, layout);
    const format = platform === 'instagram' ? 'jpg' : 'png';
    imageUrl = await cloudinaryService.uploadImage(imageBuffer, `live-${platform}-${theme.id}-${Date.now()}`, format);
  }

  if (platform === 'instagram' && !imageUrl) {
    appLogger.error('Skipping Instagram: no image');
    return;
  }

  const saved = await postRepository.savePost({
    type: 'evening',
    platform,
    content: captionForSave,
    hashtags: hashtagsForSave,
    status: 'scheduled',
    contentTheme: theme.id,
    layout,
    imageUrl,
  });

  const bufferPostId = await bufferService.schedulePost({
    postId: saved.id,
    text,
    scheduledAt: dueAt,
    service: platform,
    imageUrl,
  });

  appLogger.info(`Scheduled ${platform}`, { postId: saved.id, bufferPostId, dueAt, imageUrl });
  console.log(`${platform}: post ${saved.id}, buffer id ${bufferPostId}, imageUrl=${imageUrl ?? '(none)'}`);
}

async function main(): Promise<void> {
  const deps = buildContainer();
  const { prisma, postRepository, groqService } = deps;

  try {
    await prisma.$connect();

    const [recentThemeIds, recentLayoutIds] = await Promise.all([
      postRepository.getRecentlyUsedThemeIds(),
      postRepository.getRecentlyUsedLayoutIds(),
    ]);
    const theme = pickWeightedTheme(recentThemeIds);
    const layout = pickLayout(recentLayoutIds);
    appLogger.info('run-live-slot: picked theme', { theme: theme.id, layout });

    const content = await groqService.generateThemedPost(theme);
    appLogger.info('run-live-slot: content generated', { headline: content.headline });

    const heroArt = await generateHeroArt(deps, theme, content);
    appLogger.info('run-live-slot: art generated');

    appLogger.info('run-live-slot: scheduling all platforms', { offsetMinutes: OFFSET_MINUTES });

    for (const platform of ['linkedin', 'twitter', 'instagram'] as const) {
      try {
        await schedulePlatform(deps, platform, theme, layout, content, heroArt);
      } catch (error) {
        appLogger.error(`Failed to schedule ${platform}; continuing with remaining platforms`, {
          platform,
          error: error instanceof Error ? error.message : String(error),
        });
        console.log(`${platform}: FAILED - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log('\n--- Content ---');
    console.log(JSON.stringify(content, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
