import axios from 'axios';
import { z } from 'zod';
import { env, isGNewsConfigured } from '../config/env.js';
import { appLogger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';
import { NEWS_CATEGORIES } from '../config/news-categories.js';
import { NewsStorySchema, type NewsStory } from '../validation/news.schema.js';

export class NewsResearchServiceError extends AppError {
  constructor(message: string) {
    super(`News research service error: ${message}`, 502);
  }
}

const TOPIC_SUMMARY =
  'AI/agentic AI/LLMs, AI chips/GPUs/semiconductors, cloud & data centers, cybersecurity, software/SaaS/DevOps, ' +
  'enterprise IT & digital transformation, quantum computing, Big Tech (Microsoft, Google, Amazon, Apple, Meta, ' +
  'Nvidia, AMD, Intel, OpenAI, Anthropic, Oracle, Salesforce, and similar), and U.S. tech markets/stocks/earnings/M&A';

// GNews's free tier caps the search query at 200 characters, so this stays
// deliberately shorter than the full TOPIC_SUMMARY beat above.
const GNEWS_QUERY =
  '(AI OR "generative AI" OR LLM OR cybersecurity OR semiconductor OR "cloud computing" OR "enterprise IT" ' +
  'OR "tech stocks" OR "big tech" OR SaaS)';

const CATEGORY_IDS = Object.keys(NEWS_CATEGORIES).join(', ');

const STORY_JSON_SHAPE = `{
  "headline": "<one factual headline, under 20 words>",
  "category": "<exactly one of: ${CATEGORY_IDS}>",
  "sourceName": "<the source publication/company name>",
  "sourceUrl": "<the source URL, or 'unknown' if none was given>",
  "isDeveloping": <true or false - true only if the text says this is still unfolding/unconfirmed>,
  "isMarketStory": <true or false - true only if this is about stock prices, earnings, Nasdaq, or market movements>,
  "summary": "<4-8 sentences covering what happened, why it matters, and what could happen next. If isMarketStory is
    true, structure it as two clearly labeled parts: 'FACT: ...' for only what happened, and 'ANALYSIS: ...' for
    why it may be happening - never a buy/sell recommendation or guaranteed prediction.>"
}`;

/**
 * Deliberately just a plain research ask, with no structured-output format
 * demanded - asking a search-enabled model to also produce a strict JSON
 * template in the same turn was pushing Groq's `compound` model into
 * excessive multi-query search fan-out, which intermittently tripped a
 * request-size guard ("413 Request Entity Too Large") independent of this
 * prompt's own size - reproduced even on a clean GitHub Actions runner with
 * no prior calls, so it wasn't a rate-limit artifact. Structuring into the
 * NewsStory shape happens as a separate, non-search extraction call - see
 * extractStory().
 */
function buildSearchPrompt(recentHeadlines: string[]): string {
  const avoidBlock =
    recentHeadlines.length > 0
      ? ` Avoid picking a story matching any of these recently-covered angles: ${recentHeadlines.slice(0, 8).join(' | ')}.`
      : '';

  return `Search the web for today's single most important technology/IT news story. The beat is: ${TOPIC_SUMMARY}.${avoidBlock}

Only report a real story you actually found via search - never invent one. Prefer original sources, official
company announcements, or reputable technology/business publications. Tell me: the headline, the source
publication/company name and its URL, whether the story is still developing/unconfirmed, whether it's about stock
prices/earnings/market movements, and a summary of what happened, what technology is involved, why it matters for
businesses and IT leaders, and what could happen next.`;
}

function buildExtractionPrompt(rawText: string): string {
  return `Extract the single news story described below into the exact JSON shape requested. Do not add, invent, or
change any facts - only restructure what's already stated.

Research text:
"""
${rawText}
"""

Output JSON only with this exact shape:
${STORY_JSON_SHAPE}`;
}

function buildSelectionPrompt(articlesText: string, recentHeadlines: string[]): string {
  const avoidBlock =
    recentHeadlines.length > 0
      ? `\nAvoid selecting a story matching any of these recently-covered angles: ${recentHeadlines.slice(0, 8).join(' | ')}\n`
      : '';

  return `Below are real, recently-published articles from a news search. Some may be irrelevant (consumer gadgets,
gaming, entertainment) - ignore those. From the genuinely IT/enterprise-technology-relevant articles, select the
SINGLE most important one for ALPHAZOX's audience (CIOs, CTOs, IT leaders, developers, enterprise decision-makers).
${avoidBlock}
Articles:
"""
${articlesText}
"""

Output JSON only with this exact shape, using only facts from the article you selected - do not add or invent
anything beyond what's stated:
${STORY_JSON_SHAPE}`;
}

const GeminiGroundedResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
        groundingMetadata: z
          .object({
            groundingChunks: z
              .array(z.object({ web: z.object({ uri: z.string().optional(), title: z.string().optional() }).optional() }))
              .optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

const GroqChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().optional() }).optional(),
      }),
    )
    .min(1),
});

const GNewsResponseSchema = z.object({
  articles: z.array(
    z.object({
      title: z.string(),
      description: z.string().optional(),
      url: z.string(),
      publishedAt: z.string().optional(),
      source: z.object({ name: z.string().optional() }).optional(),
    }),
  ),
});

/**
 * Live news discovery for the hourly ALPHAZOX pipeline, in resilience order:
 *
 * 1. Groq's `groq/compound` model (built-in web search, already covered by
 *    the existing GROQ_API_KEY, no extra billing) - at this project's
 *    ~1 search/hour cadence its free-tier limits are very unlikely to bind;
 *    exhaustion seen during development came from dozens of rapid manual
 *    test calls in one session, not real usage.
 * 2. GNews (gnews.io) - a real news-search API returning actual articles
 *    rather than an LLM deciding whether/how to search, so it sidesteps
 *    Groq compound's failure mode entirely. Optional (GNEWS_API_KEY).
 * 3. Gemini's "grounding with Google Search" tool - genuinely backed by
 *    Google Search/News, not an approximation - for whenever its account
 *    has billing enabled; until then it fails fast (free-tier quota or an
 *    account-level block).
 *
 * Same primary+fallback+fallback resilience pattern as OpenAI image
 * generation -> Pexels elsewhere in this codebase. The Groq and Gemini
 * paths return freeform grounded text (see buildSearchPrompt), structured
 * into the NewsStory shape by a separate, non-search Groq JSON-mode call
 * (extractStory) - more robust than asking a search-enabled model to also
 * hit a strict output format in one turn. GNews instead returns a list of
 * real articles for a similar JSON-mode call to select and structure from
 * (selectStoryFromArticles).
 */
export class NewsResearchService {
  async researchLatestStory(recentHeadlines: string[]): Promise<NewsStory> {
    const prompt = buildSearchPrompt(recentHeadlines);

    try {
      const rawText = await this.searchViaGroqCompound(prompt);
      const story = await this.extractStory(rawText);
      appLogger.info('News research succeeded via Groq compound', { headline: story.headline });
      return story;
    } catch (error) {
      appLogger.warn('Groq compound web search failed; falling back to GNews', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (isGNewsConfigured) {
      try {
        const articlesText = await this.fetchGNewsArticles();
        const story = await this.selectStoryFromArticles(articlesText, recentHeadlines);
        appLogger.info('News research succeeded via GNews', { headline: story.headline });
        return story;
      } catch (error) {
        appLogger.warn('GNews failed; falling back to Gemini Google Search grounding', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const { text, citation } = await this.searchViaGemini(prompt);
    const story = await this.extractStory(text);

    // Prefer a real grounding citation URL over whatever URL the model wrote
    // in prose, if Gemini actually attached one for this response.
    if (citation?.uri) {
      story.sourceUrl = citation.uri;
      if (citation.title) {
        story.sourceName = citation.title;
      }
    }

    appLogger.info('News research succeeded via Gemini', { headline: story.headline });
    return story;
  }

  private async fetchGNewsArticles(): Promise<string> {
    appLogger.info('Researching latest story via GNews');

    const response = await axios.get('https://gnews.io/api/v4/search', {
      params: {
        q: GNEWS_QUERY,
        lang: 'en',
        max: 10,
        sortby: 'publishedAt',
        token: env.GNEWS_API_KEY,
      },
      timeout: 20000,
    });

    const validation = GNewsResponseSchema.safeParse(response.data);

    if (!validation.success || validation.data.articles.length === 0) {
      throw new NewsResearchServiceError('GNews returned no usable articles');
    }

    return validation.data.articles
      .map(
        (a, i) =>
          `${i + 1}. "${a.title}" - ${a.source?.name ?? 'unknown source'} (${a.publishedAt ?? 'unknown date'})\nURL: ${a.url}\n${a.description ?? ''}`,
      )
      .join('\n\n');
  }

  private async searchViaGemini(prompt: string): Promise<{ text: string; citation?: { uri?: string; title?: string } }> {
    appLogger.info('Researching latest story via Gemini (Google Search grounding)');

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 800 },
      },
      {
        headers: {
          'x-goog-api-key': env.GEMINI_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const validation = GeminiGroundedResponseSchema.safeParse(response.data);

    if (!validation.success) {
      throw new NewsResearchServiceError('Gemini grounded response failed schema validation');
    }

    const text = validation.data.candidates[0]?.content?.parts?.[0]?.text ?? '';

    if (!text.trim()) {
      throw new NewsResearchServiceError('Gemini returned an empty research response');
    }

    const groundingChunk = validation.data.candidates[0]?.groundingMetadata?.groundingChunks?.[0]?.web;
    return { text, citation: groundingChunk };
  }

  /**
   * `groq/compound-mini` was tried here first since it's documented as one
   * tool call per request. In practice compound-mini often declines to
   * search at all ("I'm unable to perform a live web search") rather than
   * using its one allowed call, which is worse - so this uses full
   * `groq/compound` with a retry instead.
   */
  private async searchViaGroqCompound(prompt: string): Promise<string> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      appLogger.info('Researching latest story via Groq compound', { attempt });

      try {
        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'groq/compound',
            messages: [{ role: 'user', content: prompt }],
            max_completion_tokens: 700,
          },
          {
            headers: {
              Authorization: `Bearer ${env.GROQ_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          },
        );

        const validation = GroqChatResponseSchema.safeParse(response.data);

        if (!validation.success) {
          throw new NewsResearchServiceError('Groq compound response failed schema validation');
        }

        const text = validation.data.choices[0]?.message?.content ?? '';

        if (!text.trim()) {
          throw new NewsResearchServiceError('Groq compound returned an empty research response');
        }

        return text;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        appLogger.warn('Groq compound research attempt failed', { attempt, error: message });

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw lastError instanceof NewsResearchServiceError ? lastError : new NewsResearchServiceError(message);
  }

  /** Non-search Groq JSON-mode call that structures raw grounded text into the NewsStory shape. */
  private async extractStory(rawText: string): Promise<NewsStory> {
    return this.runStoryJsonCall(buildExtractionPrompt(rawText));
  }

  /** Non-search Groq JSON-mode call that picks and structures one story out of a list of real GNews articles. */
  private async selectStoryFromArticles(articlesText: string, recentHeadlines: string[]): Promise<NewsStory> {
    return this.runStoryJsonCall(buildSelectionPrompt(articlesText, recentHeadlines));
  }

  private async runStoryJsonCall(prompt: string): Promise<NewsStory> {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: env.GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 1200,
      },
      {
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const validation = GroqChatResponseSchema.safeParse(response.data);

    if (!validation.success) {
      throw new NewsResearchServiceError('Story JSON response failed schema validation');
    }

    const content = validation.data.choices[0]?.message?.content ?? '';

    let json: unknown;
    try {
      json = JSON.parse(content.replace(/```json|```/g, '').trim());
    } catch {
      throw new NewsResearchServiceError('Could not parse story JSON');
    }

    if (typeof json === 'object' && json !== null && 'category' in json) {
      const raw = json as Record<string, unknown>;
      const category = typeof raw.category === 'string' ? raw.category.toLowerCase().trim() : '';
      raw.category = NEWS_CATEGORIES[category] ? category : 'enterprise-it';
    }

    const result = NewsStorySchema.safeParse(json);

    if (!result.success) {
      throw new NewsResearchServiceError('Story JSON failed validation');
    }

    return result.data;
  }
}
