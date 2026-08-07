import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsString,
  Length,
} from 'class-validator';
import { AmbassadorCategory } from '../../../generated/prisma/enums';

export class CreateAmbassadorDto {
  @IsString()
  userId: string;

  // Cumulables : un ambassadeur peut apporter des jeunes ET des entreprises.
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AmbassadorCategory, { each: true })
  categories: AmbassadorCategory[];

  // Pays d'exercice : pilote la resolution du taux et le verrou contractuel.
  @IsString()
  @Length(2, 2)
  countryCode: string;
}
