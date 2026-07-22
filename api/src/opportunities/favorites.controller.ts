import {
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
import { FavoritesService } from './favorites.service';

@Controller('opportunities/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.favorites.list(user.sub);
  }

  @HttpCode(HttpStatus.CREATED)
  @Post(':opportunityId')
  add(
    @CurrentUser() user: AccessTokenPayload,
    @Param('opportunityId') opportunityId: string,
  ) {
    return this.favorites.add(user.sub, opportunityId);
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':opportunityId')
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('opportunityId') opportunityId: string,
  ) {
    return this.favorites.remove(user.sub, opportunityId);
  }
}
