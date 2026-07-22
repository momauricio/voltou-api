import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Public()

  @Get('health')
  health() {
    return this.tenantsService.health();
  }
}
