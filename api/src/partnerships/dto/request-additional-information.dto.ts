import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

// Demande de complément — la demande RESTE OUVERTE.
//
// Ce n'est pas une décision défavorable et le DTO le montre : aucun `reasonCode`,
// puisqu'il n'y a rien à motiver. Ce qu'il faut dire à l'organisation, c'est
// simplement ce qui manque.
export class RequestAdditionalInformationDto {
  // Les pièces attendues, en LISTE et non en paragraphe. L'écran peut en faire des
  // cases à cocher, l'organisation sait exactement ce qui reste à fournir, et la
  // demande suivante peut se comparer à la précédente.
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(3, 200, { each: true })
  @Matches(/^[^<>{}\\]*$/, { each: true })
  @Type(() => String)
  requestedItems: string[];

  // Note interne : même règle que partout, elle ne quitte pas le back-office.
  @IsString()
  @Length(10, 1000)
  internalNote: string;

  // Précision facultative pour l'organisation.
  @IsOptional()
  @IsString()
  @Length(10, 600)
  @Matches(/^[^<>{}\\]*$/, {
    message:
      'Le message destiné au partenaire ne peut pas contenir de balisage (< > { } \\).',
  })
  publicMessage?: string;

  // Date limite pour fournir le complément. Facultative, et sans effet automatique :
  // aucune tâche planifiée ne refuse un dossier parce que la date est passée.
  @IsOptional()
  @IsDateString()
  actionDeadline?: string;
}

// Réponse de l'organisation. Elle COMPLÈTE le dossier, elle ne le remplace pas :
// `Partnership.motivation`, la candidature initiale, n'est jamais écrasée.
export class ProvideAdditionalInformationDto {
  @IsString()
  @Length(20, 2000)
  response: string;
}
