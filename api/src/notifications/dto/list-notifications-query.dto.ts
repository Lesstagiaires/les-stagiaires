import { Transform } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { NotificationCategory } from '../../../generated/prisma/enums';

// Les booléens arrivent en chaîne dans une query string : on les valide comme
// telles puis on les convertit, plutôt que d'accepter n'importe quoi et de
// laisser `Boolean('false')` valoir `true` — l'erreur classique, silencieuse, et
// qui donnerait ici la liste complète au lieu des seules non lues.
const toBoolean = ({ value }: { value: unknown }) => value === 'true';

export class ListNotificationsQueryDto {
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @IsOptional()
  @IsBooleanString()
  @Transform(toBoolean)
  unreadOnly?: boolean;

  @IsOptional()
  @IsBooleanString()
  @Transform(toBoolean)
  starredOnly?: boolean;

  @IsOptional()
  @IsBooleanString()
  @Transform(toBoolean)
  includeArchived?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
