import { Injectable } from '@nestjs/common';

@Injectable()
export class SalesService {
  health() {
    return { module: 'sales', status: 'ok' };
  }
}
