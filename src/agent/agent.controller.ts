import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Public()

  @Get('health')
  health() {
    return this.agentService.health();
  }
}
