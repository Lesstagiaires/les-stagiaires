import { IsEnum } from 'class-validator';
import { UserPath } from '../../../generated/prisma/enums';

export class SetPathDto {
  // Le titulaire déclare où il en est. `IsEnum` suffit : il n'y a aucune
  // transition interdite à valider, toutes les combinaisons entre les trois
  // valeurs étant permises, retours en arrière compris.
  //
  // Volontairement PAS d'identifiant d'utilisateur dans ce DTO : la cible est
  // toujours le porteur du jeton. Un champ `userId` ici aurait ouvert la porte à
  // la modification du parcours d'autrui — une porte qu'aucun contrôle
  // applicatif n'aurait ensuite pu refermer aussi sûrement que son absence.
  @IsEnum(UserPath)
  currentPath: UserPath;
}
