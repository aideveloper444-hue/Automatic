import { PrismaClient } from '@prisma/client';
import { PostRepository } from './repositories/post.repository.js';
import { GeminiService } from './services/gemini.service.js';
import { GroqService } from './services/groq.service.js';
import { NewsResearchService } from './services/news-research.service.js';
import { BufferService } from './services/buffer.service.js';
import { CloudinaryService } from './services/cloudinary.service.js';
import { TemplateService } from './services/template.service.js';
import { OpenAiService } from './services/openai.service.js';
import { PexelsService } from './services/pexels.service.js';
import { SchedulerService } from './services/scheduler.service.js';
import { AutomationController } from './controllers/automation.controller.js';

export interface Container {
  prisma: PrismaClient;
  postRepository: PostRepository;
  geminiService: GeminiService;
  groqService: GroqService;
  newsResearchService: NewsResearchService;
  bufferService: BufferService;
  cloudinaryService: CloudinaryService;
  templateService: TemplateService;
  openAiService: OpenAiService;
  pexelsService: PexelsService;
  schedulerService: SchedulerService;
  automationController: AutomationController;
}

export function buildContainer(): Container {
  const prisma = new PrismaClient();
  const postRepository = new PostRepository(prisma);
  const geminiService = new GeminiService(postRepository);
  const groqService = new GroqService(postRepository);
  const newsResearchService = new NewsResearchService();
  const bufferService = new BufferService(postRepository);
  const cloudinaryService = new CloudinaryService();
  const templateService = new TemplateService();
  const openAiService = new OpenAiService();
  const pexelsService = new PexelsService();
  const schedulerService = new SchedulerService(
    groqService,
    newsResearchService,
    bufferService,
    cloudinaryService,
    templateService,
    openAiService,
    pexelsService,
    postRepository,
  );
  const automationController = new AutomationController(schedulerService);

  return {
    prisma,
    postRepository,
    geminiService,
    groqService,
    newsResearchService,
    bufferService,
    cloudinaryService,
    templateService,
    openAiService,
    pexelsService,
    schedulerService,
    automationController,
  };
}
