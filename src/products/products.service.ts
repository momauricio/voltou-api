import { Injectable } from '@nestjs/common';

@Injectable()
export class ProductsService {
  health() {
    return { module: 'products', status: 'ok' };
  }
}
