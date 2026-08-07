import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AmbassadorDecisionReason } from '../../../generated/prisma/enums';

// Décision administrative sur un dossier d'ambassadeur — demande de complément,
// refus, suspension, résiliation, refus de versement, contrôle antifraude.
//
// Trois champs parce que trois lecteurs différents sont en jeu (arbitrage du
// promoteur du 2026-08-02, repris du module Partenariats). La contrainte est
// STRUCTURELLE : il est impossible d'écrire une note d'administration dans le
// champ qui part en notification, puisque ce champ n'accepte qu'une valeur de la
// liste contrôlée.
//
// L'enjeu est ici plus lourd que pour les partenariats : une note du type
// « soupçon de fraude, à surveiller » partant chez l'intéressé ruinerait l'enquête
// et exposerait la plateforme. C'est pourquoi la suspicion de fraude n'a pas de
// code communicable — elle se dit COMPLIANCE_REVIEW, ce qui est vrai, suffisant,
// et ne préjuge de rien.
export class AmbassadorDecisionDto {
  // NIVEAU 1 — pour l'administration seule. Obligatoire : une décision qui touche
  // aux revenus de quelqu'un et n'est pas justifiée par écrit est inexploitable en
  // cas de contestation. Ce texte ne quitte jamais le back-office.
  @IsString()
  @Length(10, 1000)
  internalNote: string;

  // NIVEAU 2 — communicable, traduit dans les cinq langues par le gabarit.
  // NO_PUBLIC_REASON n'affiche aucune ligne ; NOT_DISCLOSED en affiche une qui dit
  // explicitement qu'aucun motif ne sera donné. Deux choix distincts.
  @IsEnum(AmbassadorDecisionReason)
  reasonCode: AmbassadorDecisionReason;

  // NIVEAU 3 — message complémentaire facultatif, rédigé À DESTINATION de
  // l'ambassadeur, dans une zone qui porte ce nom : c'est ce qui le distingue
  // d'une note interne recopiée par mégarde.
  //
  // Le balisage est refusé à la FRONTIÈRE plutôt que neutralisé au rendu. Un texte
  // qui n'entre jamais en base ne peut fuiter par aucun canal ultérieur — export,
  // PDF, back-office — que l'échappement HTML de l'e-mail ne couvrirait pas.
  // L'échappement au rendu subsiste par ailleurs : deux verrous valent mieux qu'un.
  @IsOptional()
  @IsString()
  @Length(10, 600)
  @Matches(/^[^<>{}\\]*$/, {
    message:
      'Le message destiné à l’ambassadeur ne peut pas contenir de balisage (< > { } \\).',
  })
  publicMessage?: string;
}
