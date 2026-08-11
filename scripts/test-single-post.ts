import { buildContainer } from '../src/container.js';
import { appLogger } from '../src/config/logger.js';
import { BRAND, SERVICE_TOPICS } from '../src/config/brand.js';
import { isCloudinaryConfigured } from '../src/config/env.js';

async function main(): Promise<void> {
  const { prisma, templateService, cloudinaryService, bufferService } = buildContainer();

  if (!isCloudinaryConfigured) {
    throw new Error('Cloudinary is not configured; required for this test');
  }

  try {
    await prisma.$connect();

    const topic = SERVICE_TOPICS.find((t) => t.name === 'Cloud Native Solutions')!;

    // Gemini's free-tier quota is currently exhausted (429s), so this test
    // builds text from local brand.ts data instead of calling Gemini -
    // isolates the image render + Buffer scheduling path being tested here.
    const content = `[TEST POST - please disregard]\n\n${topic.tagline}\n\n${topic.capabilities.map((c) => `- ${c}`).join('\n')}\n\nReach out to ${BRAND.name} at ${BRAND.supportEmail}.`;
    const hashtags = '#Alphazox #DigitalTransformation #Test #CloudNative';

    appLogger.info('test-single-post: rendering branded image');
    const imageBuffer = await templateService.renderServiceCard(topic, 'linkedin');

    appLogger.info('test-single-post: uploading image to Cloudinary');
    const imageUrl = await cloudinaryService.uploadImage(imageBuffer, `test-single-post-${Date.now()}`);
    appLogger.info('test-single-post: image uploaded', { imageUrl });

    const dueAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const text = `${content}\n\n${hashtags}`;

    const savedPost = await prisma.post.create({
      data: {
        type: 'morning',
        platform: 'linkedin',
        content,
        hashtags,
        status: 'pending',
        imageUrl,
      },
    });

    appLogger.info('test-single-post: scheduling to Buffer', { dueAt, postId: savedPost.id });
    const bufferPostId = await bufferService.schedulePost({
      postId: savedPost.id,
      text,
      scheduledAt: dueAt,
      service: 'linkedin',
      imageUrl,
    });

    appLogger.info('test-single-post: scheduled successfully', { bufferPostId, dueAt, imageUrl });
    process.exitCode = 0;
  } catch (error) {
    appLogger.error('test-single-post: failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
