import { IsString, Length } from 'class-validator';

// Validation en l'état d'une commission mise en contrôle par un plafond.
//
// UN SEUL CHAMP, et il est interne. Valider revient à dire « ce dépassement est
// justifié » : il n'y a rien à communiquer à l'ambassadeur qu'il ne verra pas
// déjà — il reçoit le montant que le barème lui promettait. Ajouter ici un
// message public inviterait à expliquer un contrôle dont il n'a jamais eu
// connaissance.
//
// La note reste OBLIGATOIRE : un plafond franchi puis validé sans un mot est
// exactement le genre de décision qu'on ne saura plus justifier dans un an.
export class ReleaseCommissionDto {
  @IsString()
  @Length(10, 1000)
  internalNote: string;
}
