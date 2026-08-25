import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { calculateTextSimilarity } from '../utils/similarity.js';
import { GroqServiceError } from '../utils/errors.js';
import { BRAND } from '../config/brand.js';
import { InstagramVariantSchema, ThemedPostSchema, TwitterVariantSchema } from '../validation/content.schema.js';
import { NewsPostBundleSchema, type NewsPostBundle, type NewsStory } from '../validation/news.schema.js';
import type { ContentTheme } from '../config/content-themes.js';
import type { PostRepository } from '../repositories/post.repository.js';
import type { InstagramVariantPayload, ThemedPostPayload, TwitterVariantPayload } from './gemini.service.js';

const MAX_GENERATION_ATTEMPTS = 3;
const TWITTER_MAX_GENERATION_ATTEMPTS = 5;
const TWITTER_CHAR_LIMIT = 280;
const REQUIRED_HASHTAG_COUNT = 4;

const NEWS_MAX_GENERATION_ATTEMPTS = 5;
const NEWS_INSTAGRAM_WORD_RANGE = { min: 100, max: 200 };
const NEWS_LINKEDIN_WORD_RANGE = { min: 180, max: 300 };
const NEWS_INSTAGRAM_HASHTAG_RANGE = { min: 8, max: 15 };
const NEWS_LINKEDIN_HASHTAG_RANGE = { min: 5, max: 8 };
const NEWS_TWITTER_HASHTAG_RANGE = { min: 1, max: 3 };
/**
 * Jaccard word-overlap similarity trips much more easily on short text than
 * on a full caption - two genuinely different ~30-word tweets about the same
 * theme will often share half their words (brand name, theme keywords,
 * connective words). 0.7 is right for the 80-150 word themed caption but was
 * causing Twitter to get skipped almost every run; 0.85 keeps real
 * near-duplicates out without flagging distinct tweets.
 */
const TWITTER_SIMILARITY_THRESHOLD = 0.85;

const GroqResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().optional() }).optional(),
      }),
    )
    .min(1),
});

function countHashtags(hashtags: string): number {
  return hashtags
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.startsWith('#')).length;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasAlphazoxHashtag(hashtags: string): boolean {
  return /#alphazox\b/i.test(hashtags);
}

/**
 * Drop-in text-generation alternative to GeminiService (same
 * ThemedPostPayload/TwitterVariantPayload shapes, same validation/dedup
 * rules) after Gemini's free-tier daily quota (20 requests/day) proved too
 * small for this pipeline's cadence. Groq's free tier is far more generous
 * and its API is OpenAI-compatible chat completions.
 */
export class GroqService {
  constructor(private readonly postRepository: PostRepository) {}

  private buildThemedPrompt(theme: ContentTheme): string {
    return `You are the social media content director for ${BRAND.name}, a ${BRAND.tagline} (${BRAND.website}).

Write ONE Instagram/LinkedIn post for the content theme "${theme.label}".

Theme instructions: ${theme.guidance}

Content rules:
- This must read as genuinely educational/engaging content, not an advertisement - UNLESS the theme is
  specifically "Alphazox Brand Story", which is the only theme allowed to be promotional.
- Never invent or approximate statistics, customer counts, revenue, awards, certifications, or
  partnerships. If you're not certain a specific number is accurate, do not include a number at all.
- Do not give harmful, exploit, or attack-execution instructions under any theme.
- Keep it concrete and specific - avoid generic filler like "unlock possibilities" or "drive growth."

Output JSON only with keys: headline, subheadline, caption, hashtags.
- "headline": an array of 1 to 3 very short punchy lines (each under 6 words) that work as large
  display text on an image - this is the single main idea of the post, not a sentence.
- "subheadline": one short supporting sentence (under 18 words) that adds context under the headline.
- "caption": the full social caption, 80-150 words, engaging, ends with a soft call to action. Only
  include "reach out to us at ${BRAND.supportEmail}" as the CTA if the theme is "Alphazox Brand Story" -
  for all other themes end with something that invites discussion or reflection instead.
- "hashtags": a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT} relevant hashtags,
  NOT a JSON array.`;
  }

  async generateThemedPost(theme: ContentTheme): Promise<ThemedPostPayload> {
    const prompt = this.buildThemedPrompt(theme);

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGroqApi(prompt, `Themed(${theme.id})`, attempt);

      if (rawText === null) {
        continue;
      }

      const validation = ThemedPostSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Groq response failed schema validation for themed post', {
          theme: theme.id,
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { headline, subheadline, caption, hashtags } = validation.data;

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('Themed post did not have exactly the required hashtag count', {
          theme: theme.id,
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (await this.isDuplicateAgainstRecent(caption, 'linkedin')) {
        appLogger.info(`Duplicate detected for themed post (${theme.id}); regenerating content`, { attempt });
        continue;
      }

      return { headline, subheadline, caption, hashtags };
    }

    throw new GroqServiceError(`Unable to generate a unique themed post (${theme.id}) after retries`);
  }

  /**
   * Instagram used to reuse the LinkedIn caption verbatim - same words posted
   * to two platforms every hour. This rewrites it into its own caption (like
   * generateTwitterVariant does for Twitter) so all three platforms carry
   * distinct wording.
   */
  async generateInstagramVariant(
    topic: string,
    sourceContent: string,
    fallbackCaption: string,
    fallbackHashtags: string,
  ): Promise<InstagramVariantPayload> {
    const prompt = `Rewrite the following idea as a fresh Instagram caption, for
${BRAND.name} (${BRAND.tagline}).
Idea/topic: ${topic}
Source post (for context only, rewrite in your own words, do not copy sentences from it):
"""
${sourceContent}
"""
Requirements:
- 100-150 words, engaging, tasteful use of emojis, ends with something that invites discussion or
  reflection (a question or prompt) - not a hard sales pitch.
- Punchy, original phrasing - genuinely different wording and structure from the source post, not a
  light edit of it.
- Output JSON only with keys: caption, hashtags.
- "hashtags" MUST be a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT} relevant
  hashtags, NOT a JSON array.`;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGroqApi(prompt, 'Instagram', attempt);

      if (rawText === null) {
        continue;
      }

      const validation = InstagramVariantSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Groq response failed schema validation for Instagram variant', {
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { caption, hashtags } = validation.data;

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('Instagram variant did not have exactly the required hashtag count', {
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (
        (await this.isDuplicateAgainstRecent(caption, 'instagram')) ||
        calculateTextSimilarity(caption, sourceContent) >= 0.7
      ) {
        appLogger.info('Duplicate detected for Instagram variant; regenerating content', { attempt });
        continue;
      }

      return { caption, hashtags };
    }

    appLogger.warn(
      'Unable to generate a unique Instagram caption after retries; falling back to the LinkedIn caption',
    );
    return { caption: fallbackCaption, hashtags: fallbackHashtags };
  }

  async generateTwitterVariant(
    topic: string,
    sourceContent: string,
    fallbackHashtags?: string,
  ): Promise<TwitterVariantPayload> {
    const prompt = `Rewrite the following idea as a single, punchy tweet for X/Twitter, for
${BRAND.name} (${BRAND.tagline}).
Idea/topic: ${topic}
Source post (for context only, do not copy verbatim):
"""
${sourceContent}
"""
Requirements:
- The tweet text plus hashtags together must be under ${TWITTER_CHAR_LIMIT} characters TOTAL.
- Punchy, original phrasing - do not copy sentences from the source post.
- Output JSON only with keys: content, hashtags.
- "hashtags" MUST be a single space-separated string of EXACTLY ${REQUIRED_HASHTAG_COUNT}
  hashtags, NOT a JSON array.`;

    for (let attempt = 1; attempt <= TWITTER_MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const rawText = await this.callGroqApi(prompt, 'Twitter', attempt, TWITTER_MAX_GENERATION_ATTEMPTS);

      if (rawText === null) {
        continue;
      }

      const validation = TwitterVariantSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Groq response failed schema validation for Twitter variant', {
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const { content, hashtags } = validation.data;
      const combinedLength = `${content} ${hashtags}`.trim().length;

      if (combinedLength > TWITTER_CHAR_LIMIT) {
        appLogger.warn('Twitter variant exceeded character limit; regenerating', { attempt, combinedLength });
        continue;
      }

      if (countHashtags(hashtags) !== REQUIRED_HASHTAG_COUNT) {
        appLogger.warn('Twitter variant did not have exactly the required hashtag count', {
          attempt,
          count: countHashtags(hashtags),
        });
        continue;
      }

      if (await this.isDuplicateAgainstRecent(content, 'twitter', TWITTER_SIMILARITY_THRESHOLD)) {
        appLogger.info('Duplicate detected for Twitter variant; regenerating content', { attempt });
        continue;
      }

      return { content, hashtags };
    }

    appLogger.warn(
      'Unable to generate a unique Twitter post after retries; falling back to a truncated version of the source content so the slot is not skipped',
    );
    return this.buildFallbackTwitterVariant(sourceContent, fallbackHashtags);
  }

  /**
   * Last resort so a stubborn duplicate/validation loop never costs Twitter
   * its slot for the hour - reuses the already-approved themed caption
   * (trimmed to fit) instead of throwing and skipping the platform.
   */
  private buildFallbackTwitterVariant(sourceContent: string, fallbackHashtags?: string): TwitterVariantPayload {
    const hashtags = fallbackHashtags ?? '';
    const budget = hashtags ? TWITTER_CHAR_LIMIT - hashtags.length - 1 : TWITTER_CHAR_LIMIT;
    const trimmed =
      sourceContent.length > budget ? `${sourceContent.slice(0, Math.max(0, budget - 1)).trim()}…` : sourceContent;

    return { content: trimmed, hashtags };
  }

  private buildNewsPostPrompt(story: NewsStory, recentHeadlines: string[]): string {
    const developingNote = story.isDeveloping
      ? 'This story is still developing/unconfirmed in parts - clearly say so in every platform version (e.g. "this is a developing story").'
      : '';
    const marketNote = story.isMarketStory
      ? 'This is a U.S. technology market story. In the LinkedIn version, clearly separate a "FACT:" line (only what happened) from an "ANALYSIS:" line (why it may be happening). Never recommend buying or selling, never present speculation as a guaranteed prediction.'
      : '';
    const avoidBlock =
      recentHeadlines.length > 0
        ? `\nAvoid reusing the opening sentence, angle, or hashtag set of these recent ALPHAZOX posts:\n${recentHeadlines.map((h) => `- ${h}`).join('\n')}\n`
        : '';

    return `You are the ALPHAZOX Technology Intelligence, Content & Social Media Engine. ALPHAZOX is an IT and
digital transformation company (https://www.alphazox.com/).

Today's selected story:
Headline: ${story.headline}
Category: ${story.category}
Source: ${story.sourceName} (${story.sourceUrl})
${story.summary}
${developingNote}
${marketNote}
${avoidBlock}
Write THREE distinct, platform-specific posts about this SAME story - do not copy the same text across
platforms, each must be written fresh for its platform's audience and format. Go beyond summarizing: explain
what happened, what technology is involved, why it matters, what it means for businesses/IT leaders, and what
could happen next. Where it is genuinely, naturally relevant, connect the story to ALPHAZOX capabilities (AI/ML,
Cloud, custom software development, DevOps, data science, RPA, cybersecurity, analytics, digital transformation,
enterprise modernization, GCCs) - do not force a pitch into every post. Never invent facts or present rumor as
confirmed.

1. LINKEDIN (audience: CIOs, CTOs, CEOs, technology leaders, developers, enterprise decision-makers):
   Structure: strong opening hook, what happened, why it matters, business/enterprise implications, ALPHAZOX
   perspective, then a question to encourage discussion. MUST be at least ${NEWS_LINKEDIN_WORD_RANGE.min} words and
   no more than ${NEWS_LINKEDIN_WORD_RANGE.max} - count as you write and expand the business/enterprise
   implications section with concrete detail if you're at risk of finishing short. Authoritative, professional tone.

2. INSTAGRAM (general engaged audience):
   Structure: strong hook, what happened, why it matters, ALPHAZOX insight, engagement question/CTA. MUST be at
   least ${NEWS_INSTAGRAM_WORD_RANGE.min} words and no more than ${NEWS_INSTAGRAM_WORD_RANGE.max} - count as you
   write. Short paragraphs, emojis used sparingly
   and professionally.

3. X/TWITTER: The single most important fact plus a compelling hook and, when it fits, why it matters. Maximum
   ${TWITTER_CHAR_LIMIT} characters TOTAL including hashtags. Concise and high-impact - this must be ONE post, not
   a thread.

Also write "cardHeadline" (an array of 1 to 3 very short punchy lines, each under 6 words, for large display text
on an image - the single main idea, not a sentence) and "cardSubheadline" (one short supporting sentence, under 18
words).

Hashtag rules (apply to every platform): relevant, current, topic-specific, natural, dynamically chosen based on
THIS story (e.g. an AI story might use #AI #ArtificialIntelligence #GenerativeAI #MachineLearning; a semiconductor
story might use #Semiconductors #AIChips #ChipTechnology; a cybersecurity story might use #Cybersecurity
#DataSecurity #ZeroTrust). Do not reuse the same generic hashtag block across posts. Only use a company hashtag
(e.g. #Nvidia) if that company is genuinely central to the story. Always include #ALPHAZOX in every platform's
hashtag list.
- linkedin hashtags: EXACTLY ${NEWS_LINKEDIN_HASHTAG_RANGE.min} to ${NEWS_LINKEDIN_HASHTAG_RANGE.max} hashtags.
- instagram hashtags: EXACTLY ${NEWS_INSTAGRAM_HASHTAG_RANGE.min} to ${NEWS_INSTAGRAM_HASHTAG_RANGE.max} hashtags.
- twitter hashtags: EXACTLY ${NEWS_TWITTER_HASHTAG_RANGE.min} to ${NEWS_TWITTER_HASHTAG_RANGE.max} hashtags, and
  they must fit within the ${TWITTER_CHAR_LIMIT}-character total limit above.

Output JSON only, with this exact shape:
{
  "cardHeadline": ["...", "..."],
  "cardSubheadline": "...",
  "linkedin": { "content": "...", "hashtags": "#Tag1 #Tag2 ..." },
  "instagram": { "caption": "...", "hashtags": "#Tag1 #Tag2 ..." },
  "twitter": { "content": "...", "hashtags": "#Tag1 #Tag2 ..." }
}
Each "hashtags" value MUST be a single space-separated string, NOT a JSON array.`;
  }

  /**
   * Drafts the three ALPHAZOX news posts (LinkedIn/Instagram/X) for one
   * already-researched story (see NewsResearchService) in a single Groq
   * call. Validates per-platform word/hashtag counts and the Twitter
   * character budget from the spec, retrying on any miss the way the other
   * generation methods in this class do.
   */
  async generateNewsPostBundle(story: NewsStory, recentHeadlines: string[]): Promise<NewsPostBundle> {
    const prompt = this.buildNewsPostPrompt(story, recentHeadlines);

    for (let attempt = 1; attempt <= NEWS_MAX_GENERATION_ATTEMPTS; attempt += 1) {
      // This prompt is heavy enough (three full platform posts in one call)
      // that an instant retry can land in the same tokens-per-minute window
      // as the previous attempt and 429 again - unlike this class's other
      // generate* methods, back off between attempts instead of retrying
      // immediately.
      if (attempt > 1) {
        await sleep(4000 * (attempt - 1));
      }

      const rawText = await this.callGroqApi(
        prompt,
        `NewsBundle(${story.category})`,
        attempt,
        NEWS_MAX_GENERATION_ATTEMPTS,
        6500,
      );

      if (rawText === null) {
        continue;
      }

      const validation = NewsPostBundleSchema.safeParse(this.safeParseJson(rawText));

      if (!validation.success) {
        appLogger.warn('Groq response failed schema validation for news post bundle', {
          attempt,
          issues: validation.error.issues.map((issue) => issue.message),
        });
        continue;
      }

      const bundle = validation.data;
      const problems: string[] = [];

      const linkedinWords = countWords(bundle.linkedin.content);
      if (linkedinWords < NEWS_LINKEDIN_WORD_RANGE.min || linkedinWords > NEWS_LINKEDIN_WORD_RANGE.max) {
        problems.push(`linkedin word count ${linkedinWords}`);
      }
      const linkedinHashtags = countHashtags(bundle.linkedin.hashtags);
      if (
        linkedinHashtags < NEWS_LINKEDIN_HASHTAG_RANGE.min ||
        linkedinHashtags > NEWS_LINKEDIN_HASHTAG_RANGE.max ||
        !hasAlphazoxHashtag(bundle.linkedin.hashtags)
      ) {
        problems.push(`linkedin hashtags ${linkedinHashtags}`);
      }

      const instagramWords = countWords(bundle.instagram.caption);
      if (instagramWords < NEWS_INSTAGRAM_WORD_RANGE.min || instagramWords > NEWS_INSTAGRAM_WORD_RANGE.max) {
        problems.push(`instagram word count ${instagramWords}`);
      }
      const instagramHashtags = countHashtags(bundle.instagram.hashtags);
      if (
        instagramHashtags < NEWS_INSTAGRAM_HASHTAG_RANGE.min ||
        instagramHashtags > NEWS_INSTAGRAM_HASHTAG_RANGE.max ||
        !hasAlphazoxHashtag(bundle.instagram.hashtags)
      ) {
        problems.push(`instagram hashtags ${instagramHashtags}`);
      }

      const twitterCombinedLength = `${bundle.twitter.content} ${bundle.twitter.hashtags}`.trim().length;
      if (twitterCombinedLength > TWITTER_CHAR_LIMIT) {
        problems.push(`twitter length ${twitterCombinedLength}`);
      }
      const twitterHashtags = countHashtags(bundle.twitter.hashtags);
      if (twitterHashtags < NEWS_TWITTER_HASHTAG_RANGE.min || twitterHashtags > NEWS_TWITTER_HASHTAG_RANGE.max) {
        problems.push(`twitter hashtags ${twitterHashtags}`);
      }

      if (problems.length > 0) {
        appLogger.warn('News post bundle failed validation; regenerating', { attempt, problems });
        continue;
      }

      if (await this.isDuplicateAgainstRecent(bundle.linkedin.content, 'linkedin')) {
        appLogger.info('Duplicate detected for news post bundle; regenerating', { attempt });
        continue;
      }

      return bundle;
    }

    throw new GroqServiceError(`Unable to generate a valid news post bundle for "${story.headline}" after retries`);
  }

  private async callGroqApi(
    prompt: string,
    label: string,
    attempt: number,
    maxAttempts: number = MAX_GENERATION_ATTEMPTS,
    maxCompletionTokens: number = 3000,
  ): Promise<string | null> {
    appLogger.info('Calling Groq chat completions API', { label, attempt, model: env.GROQ_MODEL });

    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: env.GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          // This org's Groq tier caps at 8000 tokens/minute account-wide, so
          // this stays capped rather than uncapped - but too low and a
          // reasoning model can burn its whole budget on hidden reasoning
          // tokens and get cut off mid-JSON (Groq returns 400
          // json_validate_failed: "max completion tokens reached before
          // generating a valid document"). Callers with a larger prompt
          // (see generateNewsPostBundle) pass a higher ceiling.
          max_completion_tokens: maxCompletionTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      );

      const validation = GroqResponseSchema.safeParse(response.data);

      if (!validation.success) {
        appLogger.warn('Groq response envelope failed schema validation', { label, attempt });
        return null;
      }

      return validation.data.choices[0]?.message?.content ?? '';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const responseData = (error as { response?: { data?: unknown } })?.response?.data;
      appLogger.error('Groq API call failed', { label, attempt, error: message, responseData });

      if (attempt === maxAttempts) {
        throw new GroqServiceError(message);
      }

      return null;
    }
  }

  private async isDuplicateAgainstRecent(text: string, platform: string, threshold = 0.7): Promise<boolean> {
    const recentPosts = await this.postRepository.findRecentPostsByPlatform(platform, 20);
    return recentPosts.some(
      (post) => calculateTextSimilarity(post.content, text) >= threshold,
    );
  }

  private safeParseJson(raw: string): Record<string, unknown> | null {
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}
