import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { NotificationCategory } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';

// Centre de Notifications. Aucune route n'est réservée à un rôle : un utilisateur
// n'y voit jamais que ses propres notifications, le cloisonnement se faisant par
// le userId issu du jeton — jamais par un identifiant fourni dans la requête.
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  // Les routes LITTÉRALES sont déclarées avant celles en ':id' — Express résout
  // dans l'ordre d'enregistrement, et « preferences » ou « counts » ne doivent
  // jamais être pris pour des identifiants de notification.

  @Get('mine')
  listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.listMine(user.sub, query);
  }

  @Get('counts')
  counts(@CurrentUser() user: AccessTokenPayload) {
    return this.notifications.countsMine(user.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Post('read-all')
  markAllRead(
    @CurrentUser() user: AccessTokenPayload,
    @Body() body: { category?: NotificationCategory },
  ) {
    return this.notifications.markAllRead(user.sub, body?.category);
  }

  @Get('preferences')
  listPreferences(@CurrentUser() user: AccessTokenPayload) {
    return this.preferences.listMine(user.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Put('preferences')
  updatePreference(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdatePreferenceDto,
  ) {
    return this.preferences.update(
      user.sub,
      dto.category,
      dto.channel,
      dto.enabled,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':id/read')
  markRead(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':id/unread')
  markUnread(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.markUnread(user.sub, id);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':id/star')
  star(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.setStarred(user.sub, id, true);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':id/unstar')
  unstar(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.setStarred(user.sub, id, false);
  }

  // Archiver n'est PAS supprimer : la ligne reste et demeure retrouvable avec
  // includeArchived=true. L'historique complet exigé par le promoteur interdit
  // toute suppression réelle — d'où l'absence délibérée de route DELETE ici.
  @HttpCode(HttpStatus.OK)
  @Patch(':id/archive')
  archive(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.setArchived(user.sub, id, true);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':id/unarchive')
  unarchive(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.setArchived(user.sub, id, false);
  }
}
