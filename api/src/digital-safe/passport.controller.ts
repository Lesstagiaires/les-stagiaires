import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/token.service';
import { PassportService } from './passport.service';

@Controller('digital-safe/passport')
export class PassportController {
  constructor(private readonly passport: PassportService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':userId')
  get(
    @Param('userId') userId: string,
    @CurrentUser() viewer?: AccessTokenPayload,
  ) {
    return this.passport.getPassport(userId, viewer?.sub);
  }
}
