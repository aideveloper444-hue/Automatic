import { Request, Response } from 'express';
import { z } from 'zod';
import { sendError, sendSuccess } from '../utils/response.js';
import { SchedulerService } from '../services/scheduler.service.js';

const TriggerRunSchema = z.object({});

export class AutomationController {
  constructor(private readonly schedulerService: SchedulerService) {}

  async triggerRun(req: Request, res: Response) {
    try {
      TriggerRunSchema.parse(req.body ?? {});
      await this.schedulerService.runHourlyAutomation();
      sendSuccess(res, { triggered: true }, 'Hourly automation completed');
    } catch (error) {
      sendError(res, 500, error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
