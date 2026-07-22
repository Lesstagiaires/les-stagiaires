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
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizations.create(user.sub, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.organizations.listMine(user.sub);
  }

  @Public()
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.organizations.getById(id);
  }

  // Réservé à un compte ADMIN — jamais d'auto-vérification (CLAUDE.md §3).
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post(':id/verify')
  verify(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.organizations.verify(admin.sub, id);
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(@CurrentUser() admin: AccessTokenPayload, @Param('id') id: string) {
    return this.organizations.reject(admin.sub, id);
  }
}
