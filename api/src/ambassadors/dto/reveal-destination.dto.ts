import { IsEnum, IsString, Length, Matches } from 'class-validator';
import {
  HUMAN_ACCESS_PURPOSES,
  PaymentDetailAccessPurpose,
} from '../payment-detail-access';

// Demande de lecture des coordonnées de versement EN CLAIR par un administrateur.
//
// « Personne ne lit les coordonnées de paiement sans raison métier explicite. »
// — exigence du promoteur du 2026-08-04.
//
// Deux champs, tous deux obligatoires : POURQUOI (motif contrôlé) et DANS QUEL
// CONTEXTE (texte libre). Le premier se compte et s'analyse — un pic de
// COMPLIANCE_INVESTIGATION dans le journal d'audit est en soi un signal ; le
// second permet de comprendre un cas particulier deux ans plus tard.
//
// Il n'y a PAS de valeur par défaut, et c'est délibéré : un motif par défaut
// serait celui que tout le monde enverrait, et le journal ne dirait plus rien.
export class RevealDestinationDto {
  @IsEnum(PaymentDetailAccessPurpose)
  @Matches(new RegExp(`^(${HUMAN_ACCESS_PURPOSES.join('|')})$`), {
    message:
      'Motif non recevable. Les motifs techniques (recopie automatique, rotation de clé) ne peuvent pas être invoqués depuis le back-office.',
  })
  purpose: PaymentDetailAccessPurpose;

  @IsString()
  @Length(10, 600)
  reason: string;
}
