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
    published?: boolean;
    bufferPostId?: string | null;
    imageUrl?: string | null;
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
        imageUrl: input.imageUrl ?? null,
      },
    });
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
