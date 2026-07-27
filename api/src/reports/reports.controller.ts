import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
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

  // Panneau de modération — réservé à un compte ADMIN (RolesGuard exige aussi la 2FA
  // active sur ce compte, CLAUDE.md §2/§3).
  @Roles('ADMIN')
  @Get()
  listAll(@Query() query: ListReportsQueryDto) {
    return this.reports.listAll(query.status);
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Patch(':id/resolve')
  resolve(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(admin.sub, id, dto);
  }
}
