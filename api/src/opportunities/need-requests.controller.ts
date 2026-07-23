import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { RespondNeedRequestDto } from './dto/respond-need-request.dto';
import { SubmitNeedRequestDto } from './dto/submit-need-request.dto';
import { NeedRequestsService } from './need-requests.service';

@Controller()
export class NeedRequestsController {
  constructor(private readonly needRequests: NeedRequestsService) {}

  @Post('organizations/:id/need-requests')
  submit(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: SubmitNeedRequestDto,
  ) {
    return this.needRequests.submit(user.sub, id, dto);
  }

  @Get('organizations/:id/need-requests')
  listMine(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.needRequests.listMine(user.sub, id);
  }

  // Réservé à un compte ADMIN — jamais d'auto-approbation par l'organisation elle-même
  // (CLAUDE.md §3).
  @Roles('ADMIN')
  @Get('need-requests/pending')
  listPending() {
    return this.needRequests.listPending();
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('need-requests/:requestId/respond')
  respond(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('requestId') requestId: string,
    @Body() dto: RespondNeedRequestDto,
  ) {
    return this.needRequests.respond(admin.sub, requestId, dto);
  }
}
