import { buildContainer } from '../src/container.js';
import { appLogger } from '../src/config/logger.js';
import { BRAND, SERVICE_TOPICS } from '../src/config/brand.js';
import { isCloudinaryConfigured } from '../src/config/env.js';

async function main(): Promise<void> {
  const { prisma, postRepository, geminiService, templateService, openAiService, cloudinaryService } =
    buildContainer();

  try {
    await prisma.$connect();
    await postRepository.ensureSeedTopics(SERVICE_TOPICS.map((t) => t.name));

    const topicRecord = await postRepository.getNextTopic(SERVICE_TOPICS.map((t) => t.name));
    const topic = SERVICE_TOPICS.find((t) => t.name === topicRecord.name)!;
    appLogger.info('test-house-style-schedule: picked topic', { topic: topic.name });

    let linkedInContent: string;
    let caption: string;
    let hashtags: string;

    try {
      const linkedInPost = await geminiService.generateMorningPost(topic);
      linkedInContent = linkedInPost.content;
      const igVariant = await geminiService.generateInstagramVariant(topic.name, linkedInContent);
      caption = igVariant.caption;
      hashtags = igVariant.hashtags;
      appLogger.info('test-house-style-schedule: content generated via Gemini');
    } catch (error) {
      appLogger.warn('test-house-style-schedule: Gemini generation failed, using local fallback content', {
        error: error instanceof Error ? error.message : String(error),
      });
      caption = `[TEST POST - please disregard]\n\n${topic.tagline}\n\n${topic.capabilities
        .map((c) => `- ${c}`)
        .join('\n')}\n\nReach out to ${BRAND.name} at ${BRAND.supportEmail}.`;
      hashtags = '#Alphazox #DigitalTransformation #Test #' + topic.name.replace(/\s+/g, '');
    }

    appLogger.info('test-house-style-schedule: requesting scene art from OpenAI');
    const sceneArt = await openAiService.generateSceneArt(topic, '1024x1024');

    appLogger.info('test-house-style-schedule: rendering house-style card');
    const imageBuffer = await templateService.renderHouseStyleCard(topic, 'instagram', sceneArt);

    let imageUrl: string | undefined;
    if (isCloudinaryConfigured) {
      imageUrl = await cloudinaryService.uploadImage(imageBuffer, `test-house-style-${Date.now()}`, 'jpg');
      appLogger.info('test-house-style-schedule: uploaded to Cloudinary', { imageUrl });
    } else {
      appLogger.warn('test-house-style-schedule: Cloudinary not configured, skipping upload');
    }

    const saved = await prisma.post.create({
      data: {
        type: 'morning',
        platform: 'instagram',
        content: caption,
        hashtags,
        status: 'pending',
        topicId: topicRecord.id,
        imageUrl,
      },
    });

    appLogger.info('test-house-style-schedule: saved as pending (NOT sent to Buffer)', {
      postId: saved.id,
      imageUrl,
    });

    console.log('\n--- What would be sent to Buffer (not sent) ---');
    console.log('Platform: instagram');
    console.log('Caption:\n' + caption);
    console.log('\nHashtags: ' + hashtags);
    console.log('\nImage URL: ' + (imageUrl ?? '(none - Cloudinary not configured)'));
    console.log('\nDB post id (status=pending): ' + saved.id);
    console.log('------------------------------------------------\n');

    process.exitCode = 0;
  } catch (error) {
    appLogger.error('test-house-style-schedule: failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
