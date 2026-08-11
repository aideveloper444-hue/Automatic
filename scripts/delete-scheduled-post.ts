import { buildContainer } from '../src/container.js';
import { appLogger } from '../src/config/logger.js';

const POST_ID = Number(process.argv[2]);

if (!POST_ID) {
  throw new Error('usage: tsx scripts/delete-scheduled-post.ts <postId>');
}

async function main(): Promise<void> {
  const { prisma, bufferService } = buildContainer();

  try {
    await prisma.$connect();

    const post = await prisma.post.findUnique({ where: { id: POST_ID } });
    if (!post) {
      throw new Error(`Post ${POST_ID} not found`);
    }
    if (!post.bufferPostId) {
      throw new Error(`Post ${POST_ID} has no bufferPostId - was it actually scheduled?`);
    }

    const bufferPostIds = post.bufferPostId.split(',');
    for (const id of bufferPostIds) {
      await bufferService.deletePost(id);
    }

    await prisma.post.update({
      where: { id: POST_ID },
      data: { status: 'deleted', published: false, bufferPostId: null },
    });

    await prisma.log.create({
      data: {
        level: 'info',
        message: `Post deleted from Buffer (user-requested)`,
        metadata: JSON.stringify({ deletedBufferPostIds: bufferPostIds }),
        postId: POST_ID,
      },
    });

    appLogger.info('delete-scheduled-post: done', { postId: POST_ID, bufferPostIds });
    console.log(`\nDeleted post ${POST_ID} from Buffer (ids: ${bufferPostIds.join(', ')})\n`);
    process.exitCode = 0;
  } catch (error) {
    appLogger.error('delete-scheduled-post: failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
