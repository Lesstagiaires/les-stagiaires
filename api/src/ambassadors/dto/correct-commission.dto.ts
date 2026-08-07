import { IsInt, Min } from 'class-validator';
import { AmbassadorDecisionDto } from './ambassador-decision.dto';

// Correction à la baisse d'une commission en contrôle.
//
// Hérite des TROIS NIVEAUX DE MOTIF (arbitrage du promoteur du 2026-08-02) :
// `internalNote` reste au back-office, `reasonCode` est le seul motif qui parte
// en notification, `publicMessage` est le complément facultatif écrit POUR
// l'ambassadeur. Une correction touche à ce qu'on doit à quelqu'un : c'est
// précisément le cas où l'on veut être certain qu'aucune note d'administration
// ne parte par mégarde.
//
// La borne haute n'est pas exprimable ici — elle dépend du montant de la
// commission visée. Le service la contrôle, et la base la garantit par
// contrainte CHECK (`Commission_correction_never_upward`).
export class CorrectCommissionDto extends AmbassadorDecisionDto {
  @IsInt()
  @Min(1)
  amountMinor: number;
}
