import { IsBoolean, IsEnum } from 'class-validator';
import {
  NotificationCategory,
  NotificationChannelKind,
} from '../../../generated/prisma/enums';

export class UpdatePreferenceDto {
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @IsEnum(NotificationChannelKind)
  channel: NotificationChannelKind;

  @IsBoolean()
  enabled: boolean;
}
