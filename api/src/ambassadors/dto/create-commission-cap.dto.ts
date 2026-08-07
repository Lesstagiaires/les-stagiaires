import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import {
  CommissionCapScope,
  CommissionCapWindow,
} from '../../../generated/prisma/enums';

// Création d'un plafond de commission (arbitrage 15 du promoteur, 2026-08-02).
export class CreateCommissionCapDto {
  // Ce libellé est ce qu'un administrateur lira dans la trace d'une commission
  // retenue, des mois plus tard. « Journalier 500 000 F » vaut mieux que « P1 ».
  @IsString()
  @Length(3, 120)
  label: string;

  @IsEnum(CommissionCapScope)
  scope: CommissionCapScope;

  // Clé de campagne ou de produit. Obligatoire hors portée AMBASSADOR — le
  // service et la base le vérifient tous deux.
  @IsOptional()
  @IsString()
  @Length(1, 64)
  scopeKey?: string;

  // Absent = tous pays.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'Le code pays doit être au format ISO 3166-1 alpha-2.',
  })
  countryCode?: string;

  @IsEnum(CommissionCapWindow)
  window: CommissionCapWindow;

  // En unité mineure, comme tout montant du système : 100 unités = 1 FCFA. On ne
  // calcule pas de l'argent avec des nombres à virgule.
  @IsInt()
  @Min(1)
  amountMinor: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'La devise doit être au format ISO 4217.' })
  currency: string;
}
