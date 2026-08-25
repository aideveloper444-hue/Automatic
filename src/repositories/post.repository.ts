import { PrismaClient } from '@prisma/client';

export class PostRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async savePost(input: {
    type: string;
    platform: string;
    content: string;
    hashtags: string;
    status: string;
    topicId?: number | null;
    contentTheme?: string | null;
    layout?: string | null;
    published?: boolean;
    bufferPostId?: string | null;
    imageUrl?: string | null;
    newsHeadline?: string | null;
    newsCategory?: string | null;
    sourceUrl?: string | null;
  }) {
    return this.prisma.post.create({
      data: {
        type: input.type,
        platform: input.platform,
        content: input.content,
        hashtags: input.hashtags,
        status: input.status,
        published: input.published ?? false,
        bufferPostId: input.bufferPostId ?? null,
        topicId: input.topicId ?? null,
        contentTheme: input.contentTheme ?? null,
        layout: input.layout ?? null,
        imageUrl: input.imageUrl ?? null,
        newsHeadline: input.newsHeadline ?? null,
        newsCategory: input.newsCategory ?? null,
        sourceUrl: input.sourceUrl ?? null,
      },
    });
  }

  /**
   * Recent story headlines (any platform, deduped), fed back into the news
   * research and drafting prompts so the hourly cycle doesn't reselect or
   * re-angle a story it already covered - see NewsResearchService and
   * GroqService.generateNewsPostBundle.
   */
  async getRecentHeadlines(limit = 30): Promise<string[]> {
    const recent = await this.prisma.post.findMany({
      where: { newsHeadline: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { newsHeadline: true },
    });
    return [...new Set(recent.map((p) => p.newsHeadline).filter((h): h is string => h !== null))];
  }

  /** Most recent content theme used (any platform), so callers can avoid picking the same theme twice in a row. */
  async getLastUsedThemeId(): Promise<string | null> {
    const last = await this.prisma.post.findFirst({
      where: { contentTheme: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { contentTheme: true },
    });
    return last?.contentTheme ?? null;
  }

  /** Most recent layout used (any platform), so callers can avoid picking the same layout twice in a row. */
  async getLastUsedLayoutId(): Promise<string | null> {
    const last = await this.prisma.post.findFirst({
      where: { layout: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { layout: true },
    });
    return last?.layout ?? null;
  }

  /**
   * Distinct content themes used across the last `postLimit` posts (any
   * platform), so callers can avoid repeating a theme within a whole batch
   * of posts, not just the single immediately-preceding one.
   */
  async getRecentlyUsedThemeIds(postLimit = 15): Promise<string[]> {
    const recent = await this.prisma.post.findMany({
      where: { contentTheme: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: postLimit,
      select: { contentTheme: true },
    });
    return [...new Set(recent.map((p) => p.contentTheme).filter((t): t is string => t !== null))];
  }

  /** Same as getRecentlyUsedThemeIds() but for layouts (only 4 layouts exist, so a smaller window). */
  async getRecentlyUsedLayoutIds(postLimit = 2): Promise<string[]> {
    const recent = await this.prisma.post.findMany({
      where: { layout: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: postLimit,
      select: { layout: true },
    });
    return [...new Set(recent.map((p) => p.layout).filter((l): l is string => l !== null))];
  }

  async findRecentPostsByPlatform(platform: string, limit = 20) {
    return this.prisma.post.findMany({
      where: { platform },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findMany(options: { limit: number; offset: number; status?: string; platform?: string }) {
    return this.prisma.post.findMany({
      where: {
        status: options.status,
        platform: options.platform,
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit,
      skip: options.offset,
      include: { topic: true },
    });
  }

  async findById(id: number) {
    return this.prisma.post.findUnique({
      where: { id },
      include: { topic: true, logs: true },
    });
  }

  async markAsPublished(postId: number, bufferPostId: string) {
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        published: true,
        bufferPostId,
        status: 'published',
      },
    });
  }

  async createLog(input: { level: string; message: string; metadata?: string; postId?: number }) {
    await this.prisma.log.create({
      data: {
        level: input.level,
        message: input.message,
        metadata: input.metadata,
        postId: input.postId,
      },
    });
  }

  /** Idempotently ensures each of the given topic names exists as a row. */
  async ensureSeedTopics(names: string[]) {
    for (const name of names) {
      await this.prisma.topic.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }
  }

  /**
   * Round-robin topic selection: picks whichever topic was used longest ago
   * (never-used topics first), marks it used now, and returns it. Callers
   * should call ensureSeedTopics() first so there's always a full pool to
   * rotate through.
   *
   * Scoped to `validNames` so any stale/orphaned rows left over from a
   * previous content strategy (e.g. free-form topics invented before this
   * project's brand config existed) are never selected just because they
   * happen to have a lower id or an untouched lastUsedAt.
   */
  async getNextTopic(validNames: string[]) {
    const topic = await this.prisma.topic.findFirst({
      where: { name: { in: validNames } },
      orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    });

    if (!topic) {
      throw new Error('No topics available - call ensureSeedTopics() first');
    }

    await this.prisma.topic.update({
      where: { id: topic.id },
      data: { lastUsedAt: new Date() },
    });

    return topic;
  }
}
