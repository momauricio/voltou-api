import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';
import { createCustomerSchema, createInterestSchema } from '../shared/schemas';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly segmentsService: SegmentsService,
  ) {}

  @Public()

  @Get('health')
  health() {
    return this.customersService.health();
  }

  @Get('segments')
  segments(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.segmentsService.compute(tenantId, storeId);
  }

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.customersService.list(tenantId, storeId);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.customersService.getDetail(tenantId, id);
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = createCustomerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.customersService.create(parsed.data);
  }

  @Post('interests')
  addInterest(@Body() body: unknown) {
    const parsed = createInterestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.customersService.addInterest(parsed.data);
  }

  @Post(':id/opt-out')
  setOptOut(
    @Param('id') id: string,
    @Body() body: { tenantId?: string; optedOut?: boolean },
  ) {
    if (!body?.tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.customersService.setOptOut(
      body.tenantId,
      id,
      body.optedOut ?? true,
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.customersService.remove(tenantId, id);
  }
}
