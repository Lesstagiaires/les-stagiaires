import { IsString, Length, Matches } from 'class-validator';

// Signalement d'une modification NON AUTORISÉE de ses coordonnées de versement
// (arbitrage 13 du promoteur, 2026-08-02).
//
// C'est un FREIN D'URGENCE : il gèle les versements sans condition et prévient
// l'administration. Rien ici ne doit ralentir quelqu'un qui vient de comprendre
// que son compte a été détourné — d'où un unique champ, et un seuil de longueur
// volontairement bas.
export class ReportPaymentDetailsDto {
  @IsString()
  @Length(5, 600)
  @Matches(/^[^<>{}\\]*$/, {
    message: 'Le signalement ne peut pas contenir de balisage (< > { } \\).',
  })
  reason: string;
}
