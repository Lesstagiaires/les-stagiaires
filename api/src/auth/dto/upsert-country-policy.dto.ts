import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { MinorGatedAction } from '../../../generated/prisma/enums';

export class UpsertCountryPolicyDto {
  @IsInt()
  @Min(0)
  @Max(30)
  minInternshipAge: number;

  @IsInt()
  @Min(0)
  @Max(30)
  minParentRequiredAge: number;

  @IsInt()
  @Min(15)
  @Max(30)
  civilMajorityAge: number;

  // Âge au-delà duquel plus aucun champ parent n'est affiché. Entre la
  // majorité civile et cette valeur, le contact parental est proposé par
  // COURTOISIE — jamais avec un effet fonctionnel.
  @IsInt()
  @Min(15)
  @Max(30)
  parentalInfoMaxAge: number;

  // ==========================================================================
  // LES DÉLAIS APRÈS UN REFUS PARENTAL
  //
  // Bornes hautes et basses ici, mais la CROISSANCE (délai 1 ≤ 2 ≤ final) est
  // vérifiée par une contrainte CHECK en base, pas seulement par ce DTO.
  // Un administrateur qui inverserait les délais retournerait le sens du
  // dispositif — et personne ne le verrait avant qu'un mineur ne relance son
  // parent tous les jours.
  //
  // Le plafond de 730 jours, lui aussi doublé en base : deux ans est déjà
  // au-delà de la durée pendant laquelle la plupart des mineurs concernés
  // resteront mineurs. Au-delà, on ne configure plus un délai, on invente une
  // interdiction définitive que le promoteur a explicitement écartée.
  // ==========================================================================
  @IsInt()
  @Min(1)
  @Max(730)
  refusalDelay1Days: number;

  @IsInt()
  @Min(1)
  @Max(730)
  refusalDelay2Days: number;

  @IsInt()
  @Min(1)
  @Max(730)
  refusalDelayFinalDays: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(MinorGatedAction, { each: true })
  gatedActions: MinorGatedAction[];
}
