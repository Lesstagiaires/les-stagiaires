import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';

@Controller('opportunities/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.alerts.list(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateAlertDto) {
    return this.alerts.create(user.sub, dto);
  }

  @Get(':id/matches')
  getMatches(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.alerts.getMatches(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.alerts.remove(user.sub, id);
  }
}
