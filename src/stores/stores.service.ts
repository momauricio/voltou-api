import { Injectable } from '@nestjs/common';

@Injectable()
export class StoresService {
  health() {
    return { module: 'stores', status: 'ok' };
  }
}
