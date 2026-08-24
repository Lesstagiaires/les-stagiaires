import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { ChangeOrganizationCategoryDto } from './dto/change-organization-category.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationPageDto } from './dto/update-organization-page.dto';
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

  // FR-ORG-013 : vitrine publique des partenaires signés — déclarée avant GET :id
  // (route générique) pour éviter que Nest ne résolve "partners" comme un identifiant.
  @Public()
  @Get('partners')
  listPartners() {
    return this.organizations.listPartners();
  }

  @Public()
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.organizations.getPublicById(id);
  }

  // FR-ORG-003 : page publique et marque employeur.
  //
  // NE JAMAIS Y AJOUTER LA CATÉGORIE. Cette route s'appuie sur
  // `assertCanManage`, qui n'exclut que VIEWER : un RECRUITER y a donc accès.
  // Déclarer ce qu'EST une organisation n'est pas de la gestion de vitrine, et
  // relève du propriétaire ou d'un administrateur — voir `PATCH :id/category`.
  @Patch(':id/page')
  updatePublicPage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationPageDto,
  ) {
    return this.organizations.updatePublicPage(user.sub, id, dto);
  }

  // V6-3 — catégorie précise. Route DISTINCTE de `:id/page`, à dessein : elle
  // porte un garde plus strict, réservé au propriétaire et aux administrateurs.
  // La famille reste immuable ; seule la précision change, à l'intérieur d'elle.
  @HttpCode(HttpStatus.OK)
  @Patch(':id/category')
  changeCategory(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ChangeOrganizationCategoryDto,
  ) {
    return this.organizations.changeCategory(user.sub, id, dto.category);
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

  // FR-ORG-013 : réservé à un compte ADMIN, distinct de la vérification (CLAUDE.md §3).
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post(':id/partnership/sign')
  signPartnership(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.organizations.signPartnership(admin.sub, id);
  }
}
