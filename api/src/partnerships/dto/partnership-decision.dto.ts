import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { PartnershipDecisionReason } from '../../../generated/prisma/enums';

// Décision administrative défavorable — refus, suspension, résiliation, ou intention
// de résilier annoncée par la plateforme.
//
// Trois champs, et non un seul, parce que trois lecteurs différents sont en jeu
// (arbitrage du promoteur du 2026-08-02). La contrainte est structurelle : il est
// IMPOSSIBLE d'écrire une note d'administration dans le champ qui part en e-mail,
// puisque ce champ n'accepte qu'une valeur de la liste contrôlée.
export class PartnershipDecisionDto {
  // NIVEAU 1 — pour l'administration seule. Champ libre, obligatoire : une décision
  // sans justification écrite est inexploitable en cas de contestation. Ce texte
  // n'est jamais transmis à l'organisation, ni par e-mail, ni par notification.
  @IsString()
  @Length(10, 1000)
  internalNote: string;

  // NIVEAU 2 — communicable. Traduit dans les cinq langues par le gabarit.
  // NO_PUBLIC_REASON n'affiche aucune ligne ; NOT_DISCLOSED en affiche une qui dit
  // explicitement que le motif ne sera pas communiqué. Deux choix distincts.
  @IsEnum(PartnershipDecisionReason)
  reasonCode: PartnershipDecisionReason;

  // NIVEAU 3 — message complémentaire facultatif, rédigé À DESTINATION de
  // l'organisation. Il est écrit en connaissance de cause, dans une zone qui porte
  // ce nom ; c'est ce qui le distingue d'une note interne recopiée par mégarde.
  //
  // Contraintes exigées par le promoteur : limité en longueur, et affiché comme
  // TEXTE CONTRÔLÉ. Le balisage est refusé ici, à la frontière, plutôt que d'être
  // neutralisé au rendu — un texte qui n'entre jamais en base ne peut fuiter par
  // aucun canal ultérieur (export CSV, PDF, back-office) que l'échappement HTML de
  // l'e-mail ne protégerait pas. L'échappement au rendu subsiste par ailleurs :
  // deux verrous valent mieux qu'un.
  @IsOptional()
  @IsString()
  @Length(10, 600)
  @Matches(/^[^<>{}\\]*$/, {
    message:
      'Le message destiné au partenaire ne peut pas contenir de balisage (< > { } \\).',
  })
  publicMessage?: string;

  // Échéance de l'action attendue, s'il y en a une. JAMAIS une date d'expiration du
  // partenariat : contester une résiliation ou régulariser un dossier peut avoir un
  // délai, le partenariat lui-même n'en a pas.
  @IsOptional()
  @IsDateString()
  actionDeadline?: string;

  // Une phase contradictoire est-elle effectivement prévue par le contrat ou la
  // procédure ? Le gabarit n'annonce un échange entre les parties que si la réponse
  // est oui — annoncer une discussion qui n'aura pas lieu créerait une attente que
  // la plateforme ne peut pas honorer, et pourrait être opposé à LES STAGIAIRES.
  @IsOptional()
  @IsBoolean()
  contradictoryProcedure?: boolean;
}
