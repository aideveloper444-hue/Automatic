import { buildContainer } from '../src/container.js';
import { appLogger } from '../src/config/logger.js';

const POST_ID = Number(process.argv[2]);
const HOURS = Number(process.argv[3]);
const MINUTES = Number(process.argv[4] ?? 0);

if (!POST_ID || Number.isNaN(HOURS)) {
  throw new Error('usage: tsx scripts/approve-schedule-post.ts <postId> <hours24> [minutes]');
}

function buildScheduleDateString(referenceInstant: Date, hours: number, minutes: number): string {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
  const istShifted = new Date(referenceInstant.getTime() + IST_OFFSET_MS);
  const year = istShifted.getUTCFullYear();
  const month = istShifted.getUTCMonth() + 1;
  const day = istShifted.getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, '0');

  return new Date(
    `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00+05:30`,
  ).toISOString();
}

async function main(): Promise<void> {
  const { prisma, bufferService } = buildContainer();

  try {
    await prisma.$connect();

    const post = await prisma.post.findUnique({ where: { id: POST_ID } });
    if (!post) {
      throw new Error(`Post ${POST_ID} not found`);
    }
    if (post.platform !== 'linkedin' && post.platform !== 'twitter' && post.platform !== 'instagram') {
      throw new Error(`Unknown platform "${post.platform}" on post ${POST_ID}`);
    }
    if (post.platform === 'instagram' && !post.imageUrl) {
      throw new Error(`Post ${POST_ID} is Instagram but has no imageUrl`);
    }

    const dueAt = buildScheduleDateString(new Date(), HOURS, MINUTES);
    const text = post.hashtags ? `${post.content}\n\n${post.hashtags}` : post.content;

    appLogger.info('approve-schedule-post: scheduling to Buffer', {
      postId: post.id,
      platform: post.platform,
      dueAt,
    });

    const bufferPostId = await bufferService.schedulePost({
      postId: post.id,
      text,
      scheduledAt: dueAt,
      service: post.platform as 'linkedin' | 'twitter' | 'instagram',
      imageUrl: post.imageUrl ?? undefined,
    });

    appLogger.info('approve-schedule-post: scheduled successfully', { bufferPostId, dueAt });
    console.log(`\nScheduled post ${post.id} (${post.platform}) for ${dueAt} — Buffer post id(s): ${bufferPostId}\n`);
    process.exitCode = 0;
  } catch (error) {
    appLogger.error('approve-schedule-post: failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
