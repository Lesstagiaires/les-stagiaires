import { Controller, Get, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/token.service';
import { NotificationsService } from './notifications.service';

// Non réservé ADMIN : seuls des comptes ADMIN reçoivent des notifications aujourd'hui (voir
// PartnershipRequestsService.create), mais le mécanisme lui-même est générique — un
// utilisateur ne voit jamais que ses propres notifications (scoping par userId).
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('mine')
  listMine(@CurrentUser() user: AccessTokenPayload) {
    return this.notifications.listMine(user.sub);
  }

  @HttpCode(HttpStatus.OK)
  @Patch(':id/read')
  markRead(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }
}
