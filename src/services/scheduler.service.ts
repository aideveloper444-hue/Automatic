import cron from 'node-cron';
import { appLogger } from '../config/logger.js';
import { env, isCloudinaryConfigured } from '../config/env.js';
import type { ContentTheme } from '../config/content-themes.js';
import { getThemeById } from '../config/content-themes.js';
import { resolveNewsCategory } from '../config/news-categories.js';
import { AI_TECH_BEAT, HEALTHCARE_BEAT, INDUSTRY_INSIGHTS_BEAT } from '../config/news-beats.js';
import type { LayoutId } from '../config/layouts.js';
import type { ThemedPostPayload, PostType } from './gemini.service.js';
import { GroqService } from './groq.service.js';
import { NewsResearchService, type NewsBeat } from './news-research.service.js';
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

/**
 * What a scheduled post is "about" for bookkeeping (post.repository fields,
 * recent-headline dedup) - a real NewsStory for the news-researched rotation
 * slots, or a synthesized stand-in (card headline as the "headline", theme
 * id as the "category", no source) for the generated-commentary slots.
 */
interface PostContext {
  headline: string;
  category: string;
  sourceUrl?: string;
}

type RotationSlot =
  | { kind: 'news'; id: string; beat: NewsBeat }
  | { kind: 'themed'; id: string; themeId: string };

/**
 * The five-lane content strategy: AI/Tech (reach), Healthcare/EHR
 * (authority), and Industry insights (shares) are researched from live news;
 * Startup/Building Alphazox (human connection) and Alphazox products/
 * projects (business leads) are original commentary with no news lookup -
 * see GroqService.generateThemedPostBundle. One slot fires per hourly run,
 * cycling in this fixed order.
 */
const HOURLY_ROTATION: RotationSlot[] = [
  { kind: 'news', id: 'ai-tech', beat: AI_TECH_BEAT },
  { kind: 'news', id: 'healthcare', beat: HEALTHCARE_BEAT },
  { kind: 'themed', id: 'startup-story', themeId: 'building-alphazox' },
  { kind: 'news', id: 'industry-insights', beat: INDUSTRY_INSIGHTS_BEAT },
  { kind: 'themed', id: 'products', themeId: 'brand-story' },
];

/**
 * Deterministic by wall-clock hour (not a persisted counter) so the rotation
 * stays correct even if a cycle is skipped or the run cadence drifts - see
 * the self-dispatch chain in .github/workflows/hourly-automation.yml.
 */
function pickRotationSlot(referenceInstant: Date): RotationSlot {
  const hourIndex = Math.floor(referenceInstant.getTime() / 3_600_000);
  return HOURLY_ROTATION[hourIndex % HOURLY_ROTATION.length]!;
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
   * ALPHAZOX Technology Intelligence engine: pick this hour's rotation slot
   * (see HOURLY_ROTATION), either research a live story (NewsResearchService)
   * or draft original commentary from a content theme (GroqService.
   * generateThemedPostBundle) for the non-news lanes, then schedule all
   * three platform posts to Buffer for "now" - see
   * .github/workflows/hourly-automation.yml for the self-dispatch chain that
   * repeats this every hour indefinitely.
   */
  async runHourlyAutomation(): Promise<void> {
    appLogger.info('Hourly automation run started');

    const postType = resolvePostType(new Date());
    const recentHeadlines = await this.postRepository.getRecentHeadlines();
    const slot = pickRotationSlot(new Date());

    let bundle: NewsPostBundle;
    let cardTheme: ContentTheme;
    let postContext: PostContext;

    if (slot.kind === 'news') {
      let story: NewsStory;
      try {
        story = await this.newsResearchService.researchLatestStory(recentHeadlines, slot.beat);
      } catch (error) {
        appLogger.error("Failed to research a news story; skipping this hour's run", {
          rotation: slot.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      try {
        bundle = await this.groqService.generateNewsPostBundle(story, recentHeadlines);
      } catch (error) {
        appLogger.error("Failed to draft platform posts for the researched story; skipping this hour's run", {
          rotation: slot.id,
          headline: story.headline,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      const categoryVisual = resolveNewsCategory(story.category);
      cardTheme = {
        id: categoryVisual.id,
        label: categoryVisual.label,
        weight: 1,
        guidance: '',
        visualHint: categoryVisual.visualHint,
        imageKeywords: categoryVisual.imageKeywords,
      };
      postContext = { headline: story.headline, category: story.category, sourceUrl: story.sourceUrl };
    } else {
      const theme = getThemeById(slot.themeId);

      try {
        bundle = await this.groqService.generateThemedPostBundle(theme, recentHeadlines);
      } catch (error) {
        appLogger.error("Failed to draft themed platform posts; skipping this hour's run", {
          rotation: slot.id,
          theme: theme.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      cardTheme = theme;
      postContext = { headline: bundle.cardHeadline.join(' '), category: theme.id };
    }

    /**
     * Locked to "split" per user request - every scheduled post should match
     * the image-left/content-right layout used in the last pre-automation
     * run, rather than rotating across all 4 layouts.
     */
    const layout: LayoutId = 'split';
    const dueAt = this.buildScheduleDateString();

    const cardContent: ThemedPostPayload = {
      headline: bundle.cardHeadline,
      subheadline: bundle.cardSubheadline,
      caption: bundle.linkedin.content,
      hashtags: bundle.linkedin.hashtags,
    };

    const heroArt = await this.tryGenerateThemedSceneArt(cardTheme, cardContent);

    if (!heroArt) {
      appLogger.error("Skipping this hour's run: hero art generation failed", {
        rotation: slot.id,
        headline: postContext.headline,
      });
      return;
    }

    const linkedinScheduled = await this.scheduleNewsLinkedIn(
      postType,
      postContext,
      cardTheme,
      layout,
      bundle,
      dueAt,
      heroArt,
    );
    const twitterScheduled = await this.scheduleNewsTwitter(
      postType,
      postContext,
      cardTheme,
      layout,
      bundle,
      dueAt,
      heroArt,
    );
    const instagramScheduled = await this.scheduleNewsInstagram(
      postType,
      postContext,
      cardTheme,
      layout,
      bundle,
      dueAt,
      heroArt,
    );

    appLogger.info('ALPHAZOX HOURLY UPDATE', {
      rotation: slot.id,
      time: dueAt,
      category: cardTheme.label,
      headline: postContext.headline,
      primarySource: postContext.sourceUrl ? `(${postContext.sourceUrl})` : 'generated (non-news)',
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
    context: PostContext,
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
        newsHeadline: context.headline,
        newsCategory: context.category,
        sourceUrl: context.sourceUrl,
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
        headline: context.headline,
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
    context: PostContext,
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
        newsHeadline: context.headline,
        newsCategory: context.category,
        sourceUrl: context.sourceUrl,
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
        headline: context.headline,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async scheduleNewsInstagram(
    postType: PostType,
    context: PostContext,
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
        newsHeadline: context.headline,
        newsCategory: context.category,
        sourceUrl: context.sourceUrl,
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
        headline: context.headline,
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
