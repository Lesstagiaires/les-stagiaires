import { IsEnum, IsString, Length } from 'class-validator';
import { LanguageLevel } from '../../../generated/prisma/enums';

export class UpsertLanguageDto {
  @IsString()
  @Length(2, 30)
  language: string;

  @IsEnum(LanguageLevel)
  level: LanguageLevel;
}
