import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// Création d'un type de partenariat depuis le back-office.
//
// Les CINQ libellés sont obligatoires. C'est délibérément contraignant : la
// plateforme sert cinq langues, et un type créé sans traduction arabe produirait un
// écran à moitié français pour un utilisateur arabophone. Faire porter l'exigence
// par le formulaire est la seule façon de garantir qu'aucun ajout de dernière
// minute ne dégrade une langue.
export class CreatePartnershipTypeDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,49}$/, {
    message:
      'Le code doit être en majuscules, sans espace (exemple : LEGAL_SUPPORT).',
  })
  code: string;

  @IsString()
  @Length(3, 80)
  labelFr: string;

  @IsString()
  @Length(3, 80)
  labelEn: string;

  @IsString()
  @Length(3, 80)
  labelEs: string;

  @IsString()
  @Length(3, 80)
  labelAr: string;

  @IsString()
  @Length(3, 80)
  labelPt: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

// Mise à jour — le CODE N'Y FIGURE PAS, et c'est intentionnel : il est la clé de
// rattachement des partenariats existants. Un libellé mal traduit se corrige ; un
// code renommé orphelinerait silencieusement les dossiers.
export class UpdatePartnershipTypeDto {
  @IsOptional()
  @IsString()
  @Length(3, 80)
  labelFr?: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  labelEn?: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  labelEs?: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  labelAr?: string;

  @IsOptional()
  @IsString()
  @Length(3, 80)
  labelPt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}
