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

  async findTopicByName(name: string) {
    return this.prisma.topic.findUnique({ where: { name } });
  }

  async createTopicIfMissing(name: string) {
    const topic = await this.findTopicByName(name);
    if (topic) {
      return topic;
    }

    return this.prisma.topic.create({
      data: { name },
    });
  }
}
