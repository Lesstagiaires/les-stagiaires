import { IsBoolean, IsPhoneNumber, IsString, Length } from 'class-validator';

export class RequestGuardianChangeDto {
  // `@IsPhoneNumber` VALIDE SANS NORMALISER — vérifié le 2026-08-08. Le service
  // repasse donc systématiquement par `normalizeParentPhone`. Ce décorateur
  // rejette une saisie manifestement fausse tôt ; il ne produit pas la forme
  // canonique, et on ne doit jamais écrire en base la chaîne qu'il a laissé
  // passer.
  @IsPhoneNumber()
  requestedParentPhone: string;

  // La justification est OBLIGATOIRE, avec un plancher.
  //
  // Ce n'est pas de la paperasse : c'est le seul élément sur lequel un
  // administrateur peut trancher. Sans plancher, « pkoi » serait une demande
  // recevable, et la décision se prendrait sur rien — ce qui reviendrait soit à
  // tout approuver, soit à tout refuser.
  @IsString()
  @Length(30, 1000)
  reason: string;
}

export class DecideGuardianChangeDto {
  @IsString()
  requestId: string;

  @IsBoolean()
  approve: boolean;

  // Le motif de la décision est obligatoire DANS LES DEUX SENS, et doublé par
  // une contrainte CHECK en base.
  //
  // Un refus sans motif n'est pas une réponse qu'on peut opposer à quelqu'un —
  // surtout à un mineur qui vient d'exposer sa situation familiale. Et une
  // approbation sans motif empêche le contrôle : on ne peut plus distinguer,
  // six mois plus tard, un cas de vie d'une complaisance.
  @IsString()
  @Length(10, 600)
  decisionReason: string;
}
