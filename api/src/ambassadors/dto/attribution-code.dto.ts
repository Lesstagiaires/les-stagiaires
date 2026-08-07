import { IsString, Length } from 'class-validator';

export class AttributionCodeDto {
  // Longueur large a dessein : la normalisation (majuscules, retrait des espaces,
  // tirets et du prefixe LS-) se fait ensuite cote service.
  @IsString()
  @Length(4, 20)
  code: string;
}
