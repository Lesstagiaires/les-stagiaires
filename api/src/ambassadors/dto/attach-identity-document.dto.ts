import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { AmbassadorIdentityDocumentType } from '../../../generated/prisma/enums';

// Rattachement d'une pièce d'identité DÉJÀ DÉPOSÉE au Coffre-fort numérique.
//
// CE FORMULAIRE NE TRANSPORTE AUCUN FICHIER, et c'est délibéré. Le dépôt se fait
// par le module Coffre-fort, qui chiffre, analyse contre les logiciels
// malveillants, calcule une empreinte et journalise chaque accès. Accepter un
// fichier ici créerait un second chemin d'entrée pour des données « Très
// sensibles » (CLAUDE.md §1) — c'est-à-dire un second endroit où se tromper.
//
// On ne transmet donc qu'une RÉFÉRENCE. Le service vérifie ensuite que ce
// document appartient bien à la personne qui l'attache, et qu'il est classé
// comme pièce d'identité.
export class AttachIdentityDocumentDto {
  // Identifiant du document dans le Coffre-fort de l'utilisateur.
  @IsString()
  @Length(1, 40)
  documentId: string;

  @IsEnum(AmbassadorIdentityDocumentType)
  type: AmbassadorIdentityDocumentType;

  // Date d'expiration figurant sur la pièce. Facultative : tous les titres n'en
  // portent pas. Quand elle existe, le balayage quotidien s'en sert pour
  // redemander une pièce à jour plutôt que d'activer sur un document périmé.
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
