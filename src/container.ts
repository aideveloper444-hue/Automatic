import { PrismaClient } from '@prisma/client';
import { PostRepository } from './repositories/post.repository.js';
import { GeminiService } from './services/gemini.service.js';
import { BufferService } from './services/buffer.service.js';
import { CloudinaryService } from './services/cloudinary.service.js';
import { PollinationsService } from './services/pollinations.service.js';
import { SchedulerService } from './services/scheduler.service.js';
import { AutomationController } from './controllers/automation.controller.js';

export interface Container {
  prisma: PrismaClient;
  postRepository: PostRepository;
  geminiService: GeminiService;
  bufferService: BufferService;
  cloudinaryService: CloudinaryService;
  pollinationsService: PollinationsService;
  schedulerService: SchedulerService;
  automationController: AutomationController;
}

export function buildContainer(): Container {
  const prisma = new PrismaClient();
  const postRepository = new PostRepository(prisma);
  const geminiService = new GeminiService(postRepository);
  const bufferService = new BufferService(postRepository);
  const cloudinaryService = new CloudinaryService();
  const pollinationsService = new PollinationsService();
  const schedulerService = new SchedulerService(
    geminiService,
    bufferService,
    cloudinaryService,
    pollinationsService,
    postRepository,
  );
  const automationController = new AutomationController(schedulerService);

  return {
    prisma,
    postRepository,
    geminiService,
    bufferService,
    cloudinaryService,
    pollinationsService,
    schedulerService,
    automationController,
  };
}
