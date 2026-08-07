import {
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Coordonnées de versement enregistrées par l'ambassadeur (arbitrage 13 du
// promoteur, 2026-08-02).
//
// Toute modification rouvre le délai de refroidissement. C'est pour cela que ces
// coordonnées sont ENREGISTRÉES et non ressaisies à chaque demande : sans un
// objet identifiable qui change, il n'y a pas de « modification » à dater, et
// donc pas de délai possible.
export class PaymentDetailsDto {
  // Canal déclaré (« MOBILE_MONEY », « VIREMENT_BANCAIRE »).
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  method: string;

  // Repère lisible permettant à l'administration de préparer le virement hors
  // application.
  //
  // JAMAIS de code PIN ni de mot de passe d'opérateur (CLAUDE.md §6) : la
  // plateforme ne détient aucun moyen de paiement et n'en détiendra pas. Le
  // balisage est refusé à la frontière — ce libellé ressort dans des e-mails et
  // des exports, et ce qui n'entre pas en base ne peut fuiter nulle part.
  @IsString()
  @Length(3, 120)
  @Matches(/^[^<>{}\\]*$/, {
    message:
      'Le libellé de destination ne peut pas contenir de balisage (< > { } \\).',
  })
  destinationLabel: string;
}
