import cron from 'node-cron';
import { appLogger } from '../config/logger.js';
import { env, isCloudinaryConfigured } from '../config/env.js';
import { IMAGE_DIMENSIONS, SERVICE_TOPICS } from '../config/brand.js';
import { GeminiService, GeneratedPostPayload, PostType } from './gemini.service.js';
import { BufferService } from './buffer.service.js';
import { CloudinaryService } from './cloudinary.service.js';
import { PollinationsService } from './pollinations.service.js';
import type { PostRepository } from '../repositories/post.repository.js';

const SLOTS: { type: PostType; time: string }[] = [
  { type: 'morning', time: '09:00' },
  { type: 'afternoon', time: '14:00' },
  { type: 'evening', time: '19:00' },
];

export class SchedulerService {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly bufferService: BufferService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly pollinationsService: PollinationsService,
    private readonly postRepository: PostRepository,
  ) {}

  start() {
    cron.schedule(
      '0 7 * * *',
      async () => {
        await this.runDailyAutomation();
      },
      {
        timezone: env.TIMEZONE,
      },
    );

    appLogger.info('Scheduler started', { timezone: env.TIMEZONE });
  }

  async runDailyAutomation() {
    appLogger.info('Daily automation run started');
    await this.postRepository.ensureSeedTopics(SERVICE_TOPICS.map((t) => t.name));

    const scheduleStamp = new Date();

    for (const slot of SLOTS) {
      await this.runSlot(slot.type, slot.time, scheduleStamp);
    }

    appLogger.info('Daily automation run completed');
  }

  /**
   * One Alphazox service (round-robin, see PostRepository.getNextTopic) per
   * slot, generated once as the LinkedIn post (including a shared image
   * prompt), then rewritten per platform. LinkedIn/Twitter/Instagram are
   * each wrapped in their own try/catch so one platform's failure never
   * blocks the others.
   */
  private async runSlot(postType: PostType, time: string, scheduleStamp: Date): Promise<void> {
    const topicRecord = await this.postRepository.getNextTopic(SERVICE_TOPICS.map((t) => t.name));
    const serviceTopic = SERVICE_TOPICS.find((t) => t.name === topicRecord.name);

    if (!serviceTopic) {
      appLogger.error(
        `Topic "${topicRecord.name}" has no matching service definition; skipping slot`,
        {
          postType,
        },
      );
      return;
    }

    let linkedInPost: GeneratedPostPayload;

    try {
      linkedInPost = await this.generateLinkedInForSlot(postType, serviceTopic);
    } catch (error) {
      appLogger.error(
        `Failed to generate the source LinkedIn post for ${postType}; skipping slot`,
        {
          postType,
          topic: serviceTopic.name,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }

    const dueAt = this.buildScheduleDateString(scheduleStamp, time);

    await this.scheduleLinkedIn(linkedInPost, topicRecord.id, dueAt);
    await this.scheduleTwitter(linkedInPost, topicRecord.id, dueAt);
    await this.scheduleInstagram(linkedInPost, topicRecord.id, dueAt);
  }

  private async generateLinkedInForSlot(
    postType: PostType,
    topic: (typeof SERVICE_TOPICS)[number],
  ): Promise<GeneratedPostPayload> {
    switch (postType) {
      case 'morning':
        return this.geminiService.generateMorningPost(topic);
      case 'afternoon':
        return this.geminiService.generateAfternoonPost(topic);
      case 'evening':
        return this.geminiService.generateEveningPost(topic);
    }
  }

  /**
   * Generates a platform-sized image from the shared imagePrompt. Returns
   * undefined (rather than throwing) on failure or when Cloudinary isn't
   * configured, so LinkedIn/Twitter callers can fall back to a text-only
   * post instead of losing the whole slot over an image problem.
   */
  private async tryGenerateImage(
    imagePrompt: string,
    platform: keyof typeof IMAGE_DIMENSIONS,
    label: string,
  ): Promise<string | undefined> {
    if (!isCloudinaryConfigured) {
      return undefined;
    }

    try {
      const { width, height } = IMAGE_DIMENSIONS[platform];
      const imageBuffer = await this.pollinationsService.generateImage(imagePrompt, width, height);
      return await this.cloudinaryService.uploadImage(imageBuffer, `${label}-${Date.now()}`);
    } catch (error) {
      appLogger.error(`Image generation failed for ${label}; continuing without an image`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async scheduleLinkedIn(
    post: GeneratedPostPayload,
    topicId: number,
    dueAt: string,
  ): Promise<void> {
    try {
      const imageUrl = await this.tryGenerateImage(
        post.imagePrompt,
        'linkedin',
        `${post.type}-linkedin`,
      );

      const saved = await this.postRepository.savePost({
        type: post.type,
        platform: 'linkedin',
        content: post.content,
        hashtags: post.hashtags,
        status: 'scheduled',
        topicId,
        imageUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: `${post.content}\n\n${post.hashtags}`,
        scheduledAt: dueAt,
        service: 'linkedin',
        imageUrl,
      });
    } catch (error) {
      appLogger.error('LinkedIn scheduling failed for this slot', {
        postType: post.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async scheduleTwitter(
    post: GeneratedPostPayload,
    topicId: number,
    dueAt: string,
  ): Promise<void> {
    try {
      const variant = await this.geminiService.generateTwitterVariant(post.topic, post.content);
      const imageUrl = await this.tryGenerateImage(
        post.imagePrompt,
        'twitter',
        `${post.type}-twitter`,
      );

      const saved = await this.postRepository.savePost({
        type: post.type,
        platform: 'twitter',
        content: variant.content,
        hashtags: variant.hashtags,
        status: 'scheduled',
        topicId,
        imageUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: variant.hashtags ? `${variant.content} ${variant.hashtags}` : variant.content,
        scheduledAt: dueAt,
        service: 'twitter',
        imageUrl,
      });
    } catch (error) {
      appLogger.error('Twitter scheduling failed for this slot', {
        postType: post.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async scheduleInstagram(
    post: GeneratedPostPayload,
    topicId: number,
    dueAt: string,
  ): Promise<void> {
    if (!isCloudinaryConfigured) {
      appLogger.info('Skipping Instagram: Cloudinary is not configured', { postType: post.type });
      return;
    }

    try {
      const variant = await this.geminiService.generateInstagramVariant(post.topic, post.content);
      const { width, height } = IMAGE_DIMENSIONS.instagram;
      const imageBuffer = await this.pollinationsService.generateImage(
        post.imagePrompt,
        width,
        height,
      );
      const imageUrl = await this.cloudinaryService.uploadImage(
        imageBuffer,
        `${post.type}-instagram-${Date.now()}`,
      );

      const saved = await this.postRepository.savePost({
        type: post.type,
        platform: 'instagram',
        content: variant.caption,
        hashtags: variant.hashtags,
        status: 'scheduled',
        topicId,
        imageUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: `${variant.caption}\n\n${variant.hashtags}`,
        scheduledAt: dueAt,
        service: 'instagram',
        imageUrl,
      });
    } catch (error) {
      appLogger.error('Instagram scheduling failed for this slot', {
        postType: post.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Builds a UTC ISO instant for a given wall-clock time in Asia/Kolkata, on
   * the IST calendar date corresponding to `referenceInstant`. Uses a fixed
   * +05:30 offset rather than the host machine's local timezone (which is
   * UTC on most servers/containers) — Asia/Kolkata has no DST, so this is
   * exact. If TIMEZONE is ever changed to a DST-observing zone, this needs
   * to be replaced with a real IANA timezone conversion.
   */
  private buildScheduleDateString(referenceInstant: Date, time: string): string {
    const [hoursPart, minutesPart] = time.split(':');
    const hours = Number(hoursPart ?? 0);
    const minutes = Number(minutesPart ?? 0);

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
}
