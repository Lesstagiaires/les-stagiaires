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
import type { AccessTokenPayload } from '../auth/token.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { OrganizationMembersService } from './organization-members.service';

@Controller('organizations')
export class OrganizationMembersController {
  constructor(private readonly members: OrganizationMembersService) {}

  @Get('invitations')
  listMyInvitations(@CurrentUser() user: AccessTokenPayload) {
    return this.members.listMyInvitations(user.sub);
  }

  @Get(':id/members')
  listTeam(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.members.listTeam(user.sub, id);
  }

  @Post(':id/members')
  invite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.members.invite(user.sub, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/:memberId/accept')
  accept(
    @CurrentUser() user: AccessTokenPayload,
    @Param('memberId') memberId: string,
  ) {
    return this.members.accept(user.sub, memberId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('members/:memberId/decline')
  decline(
    @CurrentUser() user: AccessTokenPayload,
    @Param('memberId') memberId: string,
  ) {
    return this.members.decline(user.sub, memberId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/members/:memberId/revoke')
  revoke(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.members.revoke(user.sub, id, memberId);
  }
}
