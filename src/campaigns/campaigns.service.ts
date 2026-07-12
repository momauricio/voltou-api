import { Injectable } from '@nestjs/common';

@Injectable()
export class CampaignsService {
  health() {
    return { module: 'campaigns', status: 'ok' };
  }
}
