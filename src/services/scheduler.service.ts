import cron from 'node-cron';
import { appLogger } from '../config/logger.js';
import { env, isCloudinaryConfigured } from '../config/env.js';
import type { ContentTheme } from '../config/content-themes.js';
import { resolveNewsCategory } from '../config/news-categories.js';
import type { LayoutId } from '../config/layouts.js';
import type { ThemedPostPayload, PostType } from './gemini.service.js';
import { GroqService } from './groq.service.js';
import { NewsResearchService } from './news-research.service.js';
import { BufferService } from './buffer.service.js';
import { CloudinaryService } from './cloudinary.service.js';
import { TemplateService } from './template.service.js';
import { OpenAiService } from './openai.service.js';
import { PexelsService } from './pexels.service.js';
import { isPexelsConfigured } from '../config/env.js';
import type { BufferChannelService } from './buffer.service.js';
import type { PostRepository } from '../repositories/post.repository.js';
import type { NewsPostBundle, NewsStory } from '../validation/news.schema.js';

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
    private readonly newsResearchService: NewsResearchService,
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
   * ALPHAZOX Technology Intelligence engine: research the single most
   * important live IT/tech story of the hour (NewsResearchService, grounded
   * in Google Search via Gemini, falling back to Groq's compound web-search
   * model), draft distinct LinkedIn/Instagram/X posts about it in one Groq
   * call (GroqService.generateNewsPostBundle), then schedule all three to
   * Buffer for "now" - see .github/workflows/hourly-automation.yml for the
   * cron that repeats this every hour indefinitely.
   */
  async runHourlyAutomation(): Promise<void> {
    appLogger.info('Hourly automation run started');

    const postType = resolvePostType(new Date());
    const recentHeadlines = await this.postRepository.getRecentHeadlines();

    let story: NewsStory;
    try {
      story = await this.newsResearchService.researchLatestStory(recentHeadlines);
    } catch (error) {
      appLogger.error("Failed to research a news story; skipping this hour's run", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let bundle: NewsPostBundle;
    try {
      bundle = await this.groqService.generateNewsPostBundle(story, recentHeadlines);
    } catch (error) {
      appLogger.error("Failed to draft platform posts for the researched story; skipping this hour's run", {
        headline: story.headline,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const categoryVisual = resolveNewsCategory(story.category);
    /**
     * Locked to "split" per user request - every scheduled post should match
     * the image-left/content-right layout used in the last pre-automation
     * run, rather than rotating across all 4 layouts.
     */
    const layout: LayoutId = 'split';
    const dueAt = this.buildScheduleDateString();

    const cardTheme: ContentTheme = {
      id: categoryVisual.id,
      label: categoryVisual.label,
      weight: 1,
      guidance: '',
      visualHint: categoryVisual.visualHint,
      imageKeywords: categoryVisual.imageKeywords,
    };
    const cardContent: ThemedPostPayload = {
      headline: bundle.cardHeadline,
      subheadline: bundle.cardSubheadline,
      caption: bundle.linkedin.content,
      hashtags: bundle.linkedin.hashtags,
    };

    const heroArt = await this.tryGenerateThemedSceneArt(cardTheme, cardContent);

    if (!heroArt) {
      appLogger.error("Skipping this hour's run: hero art generation failed", { headline: story.headline });
      return;
    }

    const linkedinScheduled = await this.scheduleNewsLinkedIn(
      postType,
      story,
      cardTheme,
      layout,
      bundle,
      dueAt,
      heroArt,
    );
    const twitterScheduled = await this.scheduleNewsTwitter(postType, story, cardTheme, layout, bundle, dueAt, heroArt);
    const instagramScheduled = await this.scheduleNewsInstagram(
      postType,
      story,
      cardTheme,
      layout,
      bundle,
      dueAt,
      heroArt,
    );

    appLogger.info('ALPHAZOX HOURLY TECHNOLOGY UPDATE', {
      time: dueAt,
      category: categoryVisual.label,
      headline: story.headline,
      primarySource: `${story.sourceName} (${story.sourceUrl})`,
      linkedin: linkedinScheduled ? 'scheduled' : 'skipped',
      x: twitterScheduled ? 'scheduled' : 'skipped',
      instagram: instagramScheduled ? 'scheduled' : 'skipped',
      hashtags: {
        linkedin: bundle.linkedin.hashtags,
        instagram: bundle.instagram.hashtags,
        twitter: bundle.twitter.hashtags,
      },
    });

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

  private async scheduleNewsLinkedIn(
    postType: PostType,
    story: NewsStory,
    cardTheme: ContentTheme,
    layout: LayoutId,
    bundle: NewsPostBundle,
    dueAt: string,
    heroArt: Buffer,
  ): Promise<boolean> {
    const cardContent: ThemedPostPayload = {
      headline: bundle.cardHeadline,
      subheadline: bundle.cardSubheadline,
      caption: bundle.linkedin.content,
      hashtags: bundle.linkedin.hashtags,
    };

    try {
      const imageUrl = await this.tryGenerateImage(
        cardContent,
        cardTheme,
        layout,
        'linkedin',
        `${postType}-linkedin-${cardTheme.id}`,
        heroArt,
      );

      const saved = await this.postRepository.savePost({
        type: postType,
        platform: 'linkedin',
        content: bundle.linkedin.content,
        hashtags: bundle.linkedin.hashtags,
        status: 'scheduled',
        contentTheme: cardTheme.id,
        layout,
        imageUrl,
        newsHeadline: story.headline,
        newsCategory: story.category,
        sourceUrl: story.sourceUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: `${bundle.linkedin.content}\n\n${bundle.linkedin.hashtags}`,
        scheduledAt: dueAt,
        service: 'linkedin',
        imageUrl,
      });
      return true;
    } catch (error) {
      appLogger.error('LinkedIn scheduling failed for this slot', {
        postType,
        headline: story.headline,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Buffer's API has no thread/reply-chain field on CreatePostInput (verified
   * via GraphQL introspection), so - unlike the LinkedIn/Instagram spec -
   * every X post here is always a single tweet within the 280-character
   * limit; the drafting prompt (see GroqService.generateNewsPostBundle) is
   * instructed accordingly and never produces a thread.
   */
  private async scheduleNewsTwitter(
    postType: PostType,
    story: NewsStory,
    cardTheme: ContentTheme,
    layout: LayoutId,
    bundle: NewsPostBundle,
    dueAt: string,
    heroArt: Buffer,
  ): Promise<boolean> {
    const cardContent: ThemedPostPayload = {
      headline: bundle.cardHeadline,
      subheadline: bundle.cardSubheadline,
      caption: bundle.twitter.content,
      hashtags: bundle.twitter.hashtags,
    };

    try {
      const imageUrl = await this.tryGenerateImage(
        cardContent,
        cardTheme,
        layout,
        'twitter',
        `${postType}-twitter-${cardTheme.id}`,
        heroArt,
      );

      const saved = await this.postRepository.savePost({
        type: postType,
        platform: 'twitter',
        content: bundle.twitter.content,
        hashtags: bundle.twitter.hashtags,
        status: 'scheduled',
        contentTheme: cardTheme.id,
        layout,
        imageUrl,
        newsHeadline: story.headline,
        newsCategory: story.category,
        sourceUrl: story.sourceUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: bundle.twitter.hashtags
          ? `${bundle.twitter.content} ${bundle.twitter.hashtags}`
          : bundle.twitter.content,
        scheduledAt: dueAt,
        service: 'twitter',
        imageUrl,
      });
      return true;
    } catch (error) {
      appLogger.error('Twitter scheduling failed for this slot', {
        postType,
        headline: story.headline,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async scheduleNewsInstagram(
    postType: PostType,
    story: NewsStory,
    cardTheme: ContentTheme,
    layout: LayoutId,
    bundle: NewsPostBundle,
    dueAt: string,
    heroArt: Buffer,
  ): Promise<boolean> {
    if (!isCloudinaryConfigured) {
      appLogger.info('Skipping Instagram: Cloudinary is not configured', { postType });
      return false;
    }

    const cardContent: ThemedPostPayload = {
      headline: bundle.cardHeadline,
      subheadline: bundle.cardSubheadline,
      caption: bundle.instagram.caption,
      hashtags: bundle.instagram.hashtags,
    };

    try {
      const imageUrl = await this.tryGenerateImage(
        cardContent,
        cardTheme,
        layout,
        'instagram',
        `${postType}-instagram-${cardTheme.id}`,
        heroArt,
      );

      if (!imageUrl) {
        appLogger.error('Skipping Instagram: image rendering failed', { postType });
        return false;
      }

      const saved = await this.postRepository.savePost({
        type: postType,
        platform: 'instagram',
        content: bundle.instagram.caption,
        hashtags: bundle.instagram.hashtags,
        status: 'scheduled',
        contentTheme: cardTheme.id,
        layout,
        imageUrl,
        newsHeadline: story.headline,
        newsCategory: story.category,
        sourceUrl: story.sourceUrl,
      });

      await this.bufferService.schedulePost({
        postId: saved.id,
        text: `${bundle.instagram.caption}\n\n${bundle.instagram.hashtags}`,
        scheduledAt: dueAt,
        service: 'instagram',
        imageUrl,
      });
      return true;
    } catch (error) {
      appLogger.error('Instagram scheduling failed for this slot', {
        postType,
        headline: story.headline,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
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
