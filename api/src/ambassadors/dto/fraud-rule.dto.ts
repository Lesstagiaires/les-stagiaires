import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { FraudSignal } from '../../../generated/prisma/enums';

// Règle de détection (arbitrage du promoteur du 2026-08-04).
//
// Deux réglages seulement — un SEUIL et une FENÊTRE. Volontairement pauvre :
// « plus de N en M heures » se comprend sans documentation, et un moteur qu'on
// comprend est un moteur qu'on ose régler. Un langage de règles serait plus
// puissant sur le papier, et personne ne saurait plus dire ce qu'il déclenche.
export class CreateFraudRuleDto {
  // Identifiant stable, recopié sur chaque alerte : celle-ci reste lisible même
  // si la règle disparaît un jour.
  @IsString()
  @Length(3, 40)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message:
      'Le code doit être en majuscules, sans espace (ex. ATTRIBUTION_BURST).',
  })
  code: string;

  @IsString()
  @Length(3, 120)
  label: string;

  @IsEnum(FraudSignal)
  signal: FraudSignal;

  // Absent = tous pays. Un comportement anormal au Cameroun peut être ordinaire
  // ailleurs.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'Le code pays doit être au format ISO 3166-1 alpha-2.',
  })
  countryCode?: string;

  @IsInt()
  @Min(1)
  thresholdValue: number;

  // Un an au maximum : au-delà, la « fenêtre » n'en est plus une, et le calcul
  // balaierait tout l'historique à chaque passage.
  @IsInt()
  @Min(1)
  @Max(8760)
  windowHours: number;

  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  severity: 'INFO' | 'WARNING' | 'CRITICAL';

  // Zéro est permis, et veut dire « re-signaler à chaque passage ». Défendable
  // sur une règle critique, ruineux sur les autres : une alerte qui revient
  // chaque matin finit par ne plus être lue.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8760)
  cooldownHours?: number;
}

// Ajustement d'un seuil. La NOTE est obligatoire : desserrer un seuil est
// exactement ce que ferait un administrateur complice avant de laisser passer
// une fraude (CLAUDE.md §3 — les contrôles valent aussi pour les comptes
// privilégiés).
export class AdjustFraudRuleDto {
  @IsInt()
  @Min(1)
  thresholdValue: number;

  @IsInt()
  @Min(1)
  @Max(8760)
  windowHours: number;

  @IsString()
  @Length(10, 600)
  note: string;
}

// Instruction d'une alerte : confirmée ou écartée, jamais laissée ouverte.
//
// La note est obligatoire dans les deux cas. Elle sert surtout aux alertes
// ÉCARTÉES : une règle qu'on écarte systématiquement est une règle mal réglée,
// et c'est en relisant ces motifs qu'on s'en apercevra.
export class ReviewFraudAlertDto {
  @IsIn(['CONFIRMED', 'DISMISSED'])
  status: 'CONFIRMED' | 'DISMISSED';

  @IsString()
  @Length(10, 1000)
  note: string;
}
