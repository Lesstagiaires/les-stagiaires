import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Une modification, telle que le promoteur l'a demandée le 2026-08-02 : « quelle
// valeur a été modifiée, quelle était l'ancienne valeur, quelle est la nouvelle ».
export interface AuditChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// Contexte facultatif d'une action tracée. Tous les champs sont optionnels : les
// appels existants `record(action, userId, metadata)` restent valides, et
// l'enrichissement se fait là où il apporte quelque chose.
export interface AuditContext {
  // Sur quoi porte l'action — permet de reconstituer l'historique d'un objet donné
  // sans fouiller le JSON de toutes les lignes.
  entityType?: string;
  entityId?: string;
  changes?: AuditChange[];
  // Depuis quel poste. Utile pour distinguer une action légitime d'un accès
  // détourné sur un compte d'administration partagé.
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // D'OÙ VENAIT L'ACTION — ajouté le 2026-08-12 avec S-06-C.
  //
  // `AuditLog` porte `ipAddress` et `userAgent` depuis l'origine, mais cette
  // méthode ne les renseignait pas : seule la variante enrichie ci-dessous le
  // faisait. Conséquence observée pendant l'audit du verrouillage — le journal
  // disait « ce compte a été verrouillé » sans jamais dire par qui, et il était
  // donc impossible de distinguer un titulaire distrait d'une victime.
  //
  // Le paramètre est facultatif : les dizaines d'appels existants continuent de
  // fonctionner sans modification, et ceux qui connaissent l'origine la
  // transmettent.
  async record(
    action: string,
    userId: string | null,
    metadata?: Prisma.InputJsonValue,
    origine?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.prisma.auditLog.create({
      data: {
        action,
        userId,
        metadata,
        ipAddress: origine?.ipAddress ?? null,
        userAgent: origine?.userAgent ?? null,
      },
    });
  }

  // Variante enrichie, pour les décisions sensibles : création, modification,
  // suspension, réactivation, résiliation, changement de type, de statut, de
  // représentant, de catégorie ou d'administrateur responsable.
  //
  // La table est en AJOUT SEUL, garanti par un déclencheur PostgreSQL (migration
  // 20260802140000) : ni ce service ni aucun autre code ne peut modifier ou
  // supprimer une ligne écrite ici. C'est volontairement hors de portée de
  // l'application — un contrôle applicatif ne protège que du code qui passe par
  // l'application.
  async recordChange(
    action: string,
    userId: string | null,
    context: AuditContext,
  ) {
    await this.prisma.auditLog.create({
      data: {
        action,
        userId,
        entityType: context.entityType ?? null,
        entityId: context.entityId ?? null,
        changes: context.changes
          ? (context.changes as unknown as Prisma.InputJsonValue)
          : undefined,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        metadata: context.metadata,
      },
    });
  }
}

// Compare deux états et ne retient QUE ce qui a bougé.
//
// Journaliser l'objet entier à chaque écriture noierait le changement réel dans
// trente champs identiques — et rendrait la question « qui a changé le statut ? »
// aussi coûteuse à répondre qu'avant d'avoir un journal.
// Signature volontairement large : un champ passe souvent d'une date à `null` ou
// l'inverse, et un typage générique strict ferait échouer la compilation sur
// exactement les transitions les plus intéressantes à journaliser.
export function diffOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const [field, rawNew] of Object.entries(after)) {
    const oldValue = serialize(before[field]);
    const newValue = serialize(rawNew);
    if (oldValue === newValue) continue;
    changes.push({ field, oldValue, newValue });
  }
  return changes;
}

// Les dates sont normalisées en ISO : sans cela, deux dates égales mais distinctes
// en mémoire apparaîtraient comme un changement à chaque écriture. `undefined`
// devient `null` pour que « champ absent » et « champ vidé » se comparent.
function serialize(value: unknown): string | number | boolean | null {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return JSON.stringify(value);
}
