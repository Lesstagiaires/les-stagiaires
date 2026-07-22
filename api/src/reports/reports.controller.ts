import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.create(user.sub, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.listMine(user.sub);
  }
}
