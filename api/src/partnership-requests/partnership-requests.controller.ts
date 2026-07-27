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
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { AddPartnershipRequestNoteDto } from './dto/add-partnership-request-note.dto';
import { AssignPartnershipRequestDto } from './dto/assign-partnership-request.dto';
import { CreatePartnershipRequestDto } from './dto/create-partnership-request.dto';
import { ListPartnershipRequestsQueryDto } from './dto/list-partnership-requests-query.dto';
import { UpdatePartnershipRequestStatusDto } from './dto/update-partnership-request-status.dto';
import { PartnershipRequestsService } from './partnership-requests.service';

@Controller('partnership-requests')
export class PartnershipRequestsController {
  constructor(private readonly partnershipRequests: PartnershipRequestsService) {}

  // Formulaire public "Nous contacter" (entreprises, ONG, administrations,
  // organisations internationales, universités, écoles, centres de formation,
  // autres partenaires) — aucune authentification requise.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @Post()
  create(@Body() dto: CreatePartnershipRequestDto) {
    return this.partnershipRequests.create(dto);
  }

  // Back-office CRM — réservé ADMIN (RolesGuard exige aussi la 2FA active, CLAUDE.md §2/§3).
  @Roles('ADMIN')
  @Get()
  listAll(@Query() query: ListPartnershipRequestsQueryDto) {
    return this.partnershipRequests.listAll(query);
  }

  // Déclaré avant ":id" pour ne pas être capturé comme un identifiant.
  @Roles('ADMIN')
  @Get('assignable-users')
  listAssignableUsers() {
    return this.partnershipRequests.listAssignableUsers();
  }

  @Roles('ADMIN')
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.partnershipRequests.getById(id);
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePartnershipRequestStatusDto,
  ) {
    return this.partnershipRequests.updateStatus(admin.sub, id, dto.status);
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Patch(':id/assign')
  assign(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AssignPartnershipRequestDto,
  ) {
    return this.partnershipRequests.assign(admin.sub, id, dto.assigneeId);
  }

  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Post(':id/notes')
  addNote(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AddPartnershipRequestNoteDto,
  ) {
    return this.partnershipRequests.addNote(admin.sub, id, dto.content);
  }
}
