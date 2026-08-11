import cron from 'node-cron';
import { appLogger } from '../config/logger.js';
import { env, isCloudinaryConfigured } from '../config/env.js';
import { ContentTheme, pickWeightedTheme } from '../config/content-themes.js';
import { LayoutId, pickLayout } from '../config/layouts.js';
import type { ThemedPostPayload, PostType } from './gemini.service.js';
import { GroqService } from './groq.service.js';
import { BufferService } from './buffer.service.js';
import { CloudinaryService } from './cloudinary.service.js';
import { TemplateService } from './template.service.js';
import { OpenAiService } from './openai.service.js';
import { PexelsService } from './pexels.service.js';
import { isPexelsConfigured } from '../config/env.js';
import type { BufferChannelService } from './buffer.service.js';
import type { PostRepository } from '../repositories/post.repository.js';

const SCHEDULE_OFFSET_MINUTES = 5;
const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

/** Cosmetic label only (see GroqService.generateThemedPost) - content generation is theme-driven, not daypart-driven. */
function resolvePostType(referenceInstant: Date): PostType {
  const istHour = new Date(referenceInstant.getTime() + IST_OFFSET_MS).getUTCHours();
  if (istHour < 12) return 'morning';
  if (istHour < 17) return 'afternoon';
  return 'evening';
}

export class SchedulerService {
  constructor(
    private readonly groqService: GroqService,
    private readonly bufferService: BufferService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly templateService: TemplateService,
    private readonly openAiService: OpenAiService,
    private readonly pexelsService: PexelsService,
    private readonly postRepository: PostRepository,
  ) {}

  start() {
    cron.schedule(
      '0 * * * *',
      async () => {
        await this.runHourlyAutomation();
      },
      {
        timezone: env.TIMEZONE,
      },
    );

    appLogger.info('Scheduler started', { timezone: env.TIMEZONE, cadence: 'hourly' });
  }

  /**
   * One theme (round-robin-ish, no immediate repeat - see content-themes.ts)
   * and one hero image per run, shared across the LinkedIn/Twitter/
   * Instagram cards so a single hourly run only costs one Groq text call
   * and one OpenAI image call, not three of each.
   */
  async runHourlyAutomation(): Promise<void> {
    appLogger.info('Hourly automation run started');

    const postType = resolvePostType(new Date());

    const [recentThemeIds, recentLayoutIds] = await Promise.all([
      this.postRepository.getRecentlyUsedThemeIds(),
      this.postRepository.getRecentlyUsedLayoutIds(),
    ]);
    const theme = pickWeightedTheme(recentThemeIds);
    const layout = pickLayout(recentLayoutIds);

    let content: ThemedPostPayload;

    try {
      content = await this.groqService.generateThemedPost(theme);
    } catch (error) {
      appLogger.error('Failed to generate themed content; skipping this hour\'s run', {
        postType,
        theme: theme.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const dueAt = this.buildScheduleDateString();
    const heroArt = await this.tryGenerateThemedSceneArt(theme, content);

    if (!heroArt) {
      appLogger.error('Skipping this hour\'s run: hero art generation failed', {
        theme: theme.id,
      });
      return;
    }

    await this.scheduleLinkedIn(postType, theme, layout, content, dueAt, heroArt);
    await this.scheduleTwitter(postType, theme, layout, content, dueAt, heroArt);
    await this.scheduleInstagram(postType, theme, layout, content, dueAt, heroArt);

    appLogger.info('Hourly automation run completed');
  }

  /**
   * OpenAI's bespoke art is tried first when available; Pexels real stock
   * photography (see content-themes.ts imageKeywords) is the free fallback
   * when OpenAI fails or isn't configured (billing, quota) - this is the
   * default path right now since OpenAI billing is not being topped up.
   */
  private async tryGenerateThemedSceneArt(
    theme: ContentTheme,
    content: ThemedPostPayload,
  ): Promise<Buffer | undefined> {
    try {
      return await this.openAiService.generateThemedSceneArt(
        theme,
        content.headline,
        content.subheadline,
        '1024x1536',
      );
    } catch (error) {
      appLogger.warn('OpenAI themed scene art generation failed; falling back to Pexels', {
        theme: theme.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!isPexelsConfigured) {
      appLogger.error('Pexels is not configured either; no hero art available', { theme: theme.id });
      return undefined;
    }

    try {
      return await this.pexelsService.searchPhoto(theme.imageKeywords, 'portrait');
    } catch (error) {
      appLogger.error('Pexels photo search failed', {
        theme: theme.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Renders the themed card (logo, eyebrow, headline, hero art, slim footer
   * - see template.service.ts renderThemedPost) at the given platform's
   * dimensions and uploads it to Cloudinary. Instagram uploads as JPEG
   * (Buffer's Instagram publish path has been unreliable with PNG assets);
   * other platforms keep PNG. Returns undefined on failure so LinkedIn/
   * Twitter callers can fall back to a text-only post instead of losing the
   * whole slot over an image problem.
   */
  private async tryGenerateImage(
    content: ThemedPostPayload,
    theme: ContentTheme,
    layout: LayoutId,
    platform: BufferChannelService,
    label: string,
    heroArt: Buffer,
  ): Promise<string | undefined> {
    if (!isCloudinaryConfigured) {
      return undefined;
    }

    try {
      const imageBuffer = await this.templateService.renderThemedPost(content, theme, platform, heroArt, layout);
      const format = platform === 'instagram' ? 'jpg' : 'png';
      return await this.cloudinaryService.uploadImage(imageBuffer, `${label}-${Date.now()}`, format);
    } catch (error) {
      appLogger.error(`Image generation failed for ${label}; continuing without an image`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async scheduleLinkedIn(
    postType: PostType,
    theme: ContentTheme,
    layout: LayoutId,
    content: ThemedPostPayload,
    dueAt: string,
    heroArt: Buffer,
  ): Promise<void> {
    try {
      const imageUrl = await this.tryGenerateImage(
        content,
        theme,
        layout,
        'linkedin',
        `${postType}-linkedin-${theme.id}`,
        heroArt,
      );

      const saved = await this.postRepository.savePost({
        type: postType,
        platform: 'linkedin',
        content: content.caption,
        hashtags: content.hashtags,
        status: 'scheduled',
        contentTheme: theme.id,
        layout,
        imageUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: `${content.caption}\n\n${content.hashtags}`,
        scheduledAt: dueAt,
        service: 'linkedin',
        imageUrl,
      });
    } catch (error) {
      appLogger.error('LinkedIn scheduling failed for this slot', {
        postType,
        theme: theme.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async scheduleTwitter(
    postType: PostType,
    theme: ContentTheme,
    layout: LayoutId,
    content: ThemedPostPayload,
    dueAt: string,
    heroArt: Buffer,
  ): Promise<void> {
    try {
      const variant = await this.groqService.generateTwitterVariant(theme.label, content.caption);
      const imageUrl = await this.tryGenerateImage(
        content,
        theme,
        layout,
        'twitter',
        `${postType}-twitter-${theme.id}`,
        heroArt,
      );

      const saved = await this.postRepository.savePost({
        type: postType,
        platform: 'twitter',
        content: variant.content,
        hashtags: variant.hashtags,
        status: 'scheduled',
        contentTheme: theme.id,
        layout,
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
        postType,
        theme: theme.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async scheduleInstagram(
    postType: PostType,
    theme: ContentTheme,
    layout: LayoutId,
    content: ThemedPostPayload,
    dueAt: string,
    heroArt: Buffer,
  ): Promise<void> {
    if (!isCloudinaryConfigured) {
      appLogger.info('Skipping Instagram: Cloudinary is not configured', { postType });
      return;
    }

    try {
      const imageUrl = await this.tryGenerateImage(
        content,
        theme,
        layout,
        'instagram',
        `${postType}-instagram-${theme.id}`,
        heroArt,
      );

      if (!imageUrl) {
        appLogger.error('Skipping Instagram: image rendering failed', { postType });
        return;
      }

      const saved = await this.postRepository.savePost({
        type: postType,
        platform: 'instagram',
        content: content.caption,
        hashtags: content.hashtags,
        status: 'scheduled',
        contentTheme: theme.id,
        layout,
        imageUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: `${content.caption}\n\n${content.hashtags}`,
        scheduledAt: dueAt,
        service: 'instagram',
        imageUrl,
      });
    } catch (error) {
      appLogger.error('Instagram scheduling failed for this slot', {
        postType,
        theme: theme.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * A few minutes out from "now" rather than a fixed wall-clock time -
   * Buffer rejects scheduledAt values that aren't in the future, and an
   * hourly run's "now" varies with cron/CI trigger jitter.
   */
  private buildScheduleDateString(): string {
    return new Date(Date.now() + SCHEDULE_OFFSET_MINUTES * 60_000).toISOString();
  }
}
