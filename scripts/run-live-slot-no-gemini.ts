import { buildContainer } from '../src/container.js';
import { appLogger } from '../src/config/logger.js';
import { isCloudinaryConfigured } from '../src/config/env.js';
import { CONTENT_THEMES } from '../src/config/content-themes.js';
import { pickLayout } from '../src/config/layouts.js';
import type { LayoutId } from '../src/config/layouts.js';

const TIME = process.argv[2];
if (!TIME) {
  throw new Error('usage: tsx scripts/run-live-slot-no-gemini.ts <HH:MM>');
}

// Reused from an earlier this-session render (Gemini-generated, never published) -
// Gemini's free-tier daily quota is exhausted, so this avoids calling it again.
const theme = CONTENT_THEMES.find((t) => t.id === 'quick-tip')!;
const content = {
  headline: ['Stop Using', 'SELECT *', 'In Production'],
  subheadline: 'Querying explicit columns reduces payload size, saves memory, and speeds up database response times.',
  caption:
    "Here is a quick database performance win you can implement today: explicitly name the columns you need instead of using 'SELECT *'. When you query every column, you force the database engine to perform extra read operations and transfer unnecessary data over the network. This bloats memory usage and slows down API response times, especially as your tables scale. Naming specific columns also enables index-only scans, which drastically speeds up execution. Check your most frequent database queries today and strip out full table selects to immediately cut latency. What simple database optimization made the biggest impact on your app's performance?",
  hashtags: '#DatabaseOptimization #TechTips #DevOps #BackendDevelopment',
};

// Hand-written (not Gemini) since generateTwitterVariant also calls Gemini.
const tweetText =
  'Stop using SELECT * in production. Query only the columns you need - smaller payloads, less memory, faster response times, and index-only scans. #DatabaseOptimization #TechTips #DevOps #BackendDevelopment';

function buildScheduleDateString(referenceInstant: Date, time: string): string {
  const [hoursPart, minutesPart] = time.split(':');
  const hours = Number(hoursPart ?? 0);
  const minutes = Number(minutesPart ?? 0);
  const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
  const istShifted = new Date(referenceInstant.getTime() + IST_OFFSET_MS);
  const year = istShifted.getUTCFullYear();
  const month = istShifted.getUTCMonth() + 1;
  const day = istShifted.getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return new Date(`${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00+05:30`).toISOString();
}

async function main(): Promise<void> {
  const deps = buildContainer();
  const { prisma, templateService, cloudinaryService, postRepository, bufferService, pexelsService } = deps;

  try {
    await prisma.$connect();

    const layout: LayoutId = pickLayout();
    appLogger.info('run-live-slot-no-gemini: using cached content', { theme: theme.id, layout });

    const heroArt = await pexelsService.searchPhoto(theme.imageKeywords, 'portrait');
    appLogger.info('run-live-slot-no-gemini: Pexels art fetched');

    const dueAt = buildScheduleDateString(new Date(), TIME);

    const platformConfigs = [
      { platform: 'linkedin' as const, text: `${content.caption}\n\n${content.hashtags}`, saveCaption: content.caption, saveHashtags: content.hashtags },
      { platform: 'twitter' as const, text: tweetText, saveCaption: tweetText, saveHashtags: '' },
      { platform: 'instagram' as const, text: `${content.caption}\n\n${content.hashtags}`, saveCaption: content.caption, saveHashtags: content.hashtags },
    ];

    for (const cfg of platformConfigs) {
      try {
        let imageUrl: string | undefined;
        if (isCloudinaryConfigured) {
          const imageBuffer = await templateService.renderThemedPost(content, theme, cfg.platform, heroArt, layout);
          const format = cfg.platform === 'instagram' ? 'jpg' : 'png';
          imageUrl = await cloudinaryService.uploadImage(
            imageBuffer,
            `live-${cfg.platform}-${theme.id}-${Date.now()}`,
            format,
          );
        }

        if (cfg.platform === 'instagram' && !imageUrl) {
          console.log('instagram: FAILED - no image');
          continue;
        }

        const saved = await postRepository.savePost({
          type: 'evening',
          platform: cfg.platform,
          content: cfg.saveCaption,
          hashtags: cfg.saveHashtags,
          status: 'scheduled',
          contentTheme: theme.id,
          layout,
          imageUrl,
        });

        const bufferPostId = await bufferService.schedulePost({
          postId: saved.id,
          text: cfg.text,
          scheduledAt: dueAt,
          service: cfg.platform,
          imageUrl,
        });

        appLogger.info(`Scheduled ${cfg.platform}`, { postId: saved.id, bufferPostId, dueAt, imageUrl });
        console.log(`${cfg.platform}: post ${saved.id}, buffer id ${bufferPostId}, imageUrl=${imageUrl ?? '(none)'}`);
      } catch (error) {
        appLogger.error(`Failed to schedule ${cfg.platform}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        console.log(`${cfg.platform}: FAILED - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
