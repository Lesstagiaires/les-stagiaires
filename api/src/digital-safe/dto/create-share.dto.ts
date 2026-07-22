import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ShareTargetType } from '../../../generated/prisma/enums';

export class CreateShareDto {
  @IsEnum(ShareTargetType)
  targetType: ShareTargetType;

  // Requis si targetType = USER — vérifié en service (dépend d'un autre champ).
  @IsOptional()
  @IsString()
  sharedWithUserId?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
