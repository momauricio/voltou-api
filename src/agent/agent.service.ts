import { Injectable } from '@nestjs/common';

@Injectable()
export class AgentService {
  health() {
    return { module: 'agent', status: 'ok' };
  }
}
