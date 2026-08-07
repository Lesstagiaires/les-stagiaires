import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { OrganizationAcquisitionSource } from '../../../generated/prisma/enums';

export class CreateOrganizationDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sector?: string;

  @IsString()
  @MaxLength(100)
  country: string;

  @IsString()
  @MaxLength(100)
  city: string;

  // ==========================================================================
  // DEUX CHAMPS QUI SE RESSEMBLENT ET NE DOIVENT JAMAIS ÊTRE CONFONDUS.
  // C'est le point 9 des arbitrages du promoteur, et la confusion coûterait de
  // l'argent : « Ces deux mécanismes doivent rester totalement indépendants. »
  // ==========================================================================

  // 1. STATISTIQUE. « Comment avez-vous connu LES STAGIAIRES ? » (point 11).
  //    Alimente le tableau de bord marketing. Répondre « AMBASSADOR » ici ne
  //    rattache personne et n'ouvre AUCUN droit à commission.
  @IsOptional()
  @IsEnum(OrganizationAcquisitionSource)
  acquisitionSource?: OrganizationAcquisitionSource;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  acquisitionSourceNote?: string;

  // 2. ATTRIBUTION. Code, lien personnel ou QR d'un ambassadeur (point 10) —
  //    le seul mécanisme qui crée un rattachement. Un code invalide, inconnu ou
  //    appartenant à un ambassadeur suspendu est ignoré en silence : il ne doit
  //    jamais empêcher la création de l'organisation, qui n'a rien à voir avec
  //    le programme d'affiliation.
  @IsOptional()
  @IsString()
  @Length(4, 20)
  ambassadorCode?: string;
}
