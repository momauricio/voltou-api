import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { ImportsService } from './imports.service';

const previewSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        content: z.string().min(1).max(8_000_000),
        encoding: z.enum(['utf8', 'base64']).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const commitSchema = z.object({
  tenantId: z.string().uuid(),
});

const remapSchema = z.object({
  tenantId: z.string().uuid(),
  sheetName: z.string().min(1),
  kind: z.enum(['customers', 'products', 'sales', 'ambiguous']),
  columnMap: z
    .record(z.string(), z.number().int().nonnegative())
    .optional(),
});

@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Public()
  @Get('health')
  health() {
    return this.importsService.health();
  }

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório.');
    return this.importsService.listJobs(tenantId, storeId);
  }

  @Post('preview')
  preview(@Body() body: unknown) {
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.importsService.preview(parsed.data);
  }

  @Post(':id/remap')
  remap(@Param('id') id: string, @Body() body: unknown) {
    const parsed = remapSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    const { tenantId, sheetName, kind, columnMap } = parsed.data;
    return this.importsService.remap(tenantId, id, {
      sheetName,
      kind,
      columnMap: columnMap as Parameters<
        ImportsService['remap']
      >[2]['columnMap'],
    });
  }

  @Post(':id/commit')
  commit(@Param('id') id: string, @Body() body: unknown) {
    const parsed = commitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.importsService.commit(parsed.data.tenantId, id);
  }
}
