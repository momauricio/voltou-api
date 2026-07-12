import { Injectable } from '@nestjs/common';

@Injectable()
export class TenantsService {
  health() {
    return { module: 'tenants', status: 'ok' };
  }
}
