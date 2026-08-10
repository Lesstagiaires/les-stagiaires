import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GuardianChangeStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinorPolicyService } from './minor-policy.service';
import { isSameParentPhone, normalizeParentPhone } from './parental-phone';

// ============================================================================
// CHANGEMENT RÉEL DE REPRÉSENTANT LÉGAL — transitions C1 à C3
//
// LE PROBLÈME QUE CETTE PROCÉDURE FERME. Dès qu'un refus est enregistré et
// qu'un délai court, « changer de tuteur » devient la porte de sortie évidente :
// il suffit de désigner un autre adulte, plus complaisant, et le compteur
// devient décoratif.
//
// LE PROBLÈME QU'ELLE NE DOIT PAS CRÉER. Les vrais changements de tuteur
// existent — décès, séparation, placement, déménagement. Les interdire au
// prétexte qu'ils servent parfois de prétexte revient à punir les mineurs dont
// la situation familiale a réellement changé, qui sont aussi les plus exposés.
//
// D'où le compromis : c'est possible, mais un humain regarde. Volontairement
// lourd, parce qu'aucune règle automatique ne distingue les deux cas.
//
// CE QUE LA DÉCISION NE FAIT JAMAIS : remettre le compteur de refus à zéro.
// Elle autorise UNE demande ; elle n'efface pas l'historique. Un mineur qui
// obtiendrait un changement de tuteur après trois refus repart avec un compteur
// à trois — c'est-à-dire qu'un quatrième refus coûtera toujours six mois.
// ============================================================================

// Classification des données (CLAUDE.md §1) : la justification écrite par un
// mineur sur sa situation familiale est CONFIDENTIELLE. Elle n'est lisible que
// par l'administration, elle est journalisée à chaque décision, et elle n'est
// jamais renvoyée dans une réponse destinée à un autre utilisateur.

@Injectable()
export class GuardianChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly minorPolicy: MinorPolicyService,
  ) {}

  // --- C1 : le mineur dépose une demande ------------------------------------
  async request(childId: string, requestedParentPhone: string, reason: string) {
    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: childId },
    });

    // Recalculé, jamais lu dans `User.isMinor` : à la majorité, cette procédure
    // n'a plus d'objet, et un majeur n'a pas à justifier ses relations
    // familiales auprès d'un administrateur.
    if (!(await this.minorPolicy.requiresParentalConsent(child))) {
      throw new BadRequestException(
        "Cette procédure ne concerne que les comptes en attente d'accord parental.",
      );
    }

    const requestedParentPhoneNormalized =
      normalizeParentPhone(requestedParentPhone);

    if (isSameParentPhone(requestedParentPhone, child.phone)) {
      throw new BadRequestException(
        'Le numéro du parent/tuteur ne peut pas être le même que celui du compte.',
      );
    }

    // ========================================================================
    // LA MÊME PERSONNE N'EST PAS UN CHANGEMENT DE TUTEUR
    //
    // Comparé sous forme canonique : sans cela, resaisir le même numéro avec un
    // espace en plus produirait une « demande de changement » recevable, et
    // contournerait le délai en faisant passer le dossier devant un
    // administrateur qui n'a aucun moyen de voir la supercherie.
    // ========================================================================
    const liens = await this.prisma.parentalLink.findMany({
      where: { childId },
      select: { parentPhoneNormalized: true },
    });
    if (
      liens.some(
        (l) => l.parentPhoneNormalized === requestedParentPhoneNormalized,
      )
    ) {
      throw new BadRequestException(
        "Ce numéro est déjà celui du parent/tuteur enregistré : il ne s'agit pas d'un changement.",
      );
    }

    // Une seule demande en cours. Doublé par un index unique partiel en base :
    // deux requêtes simultanées ne peuvent pas passer toutes les deux ici.
    const enCours = await this.prisma.guardianChangeRequest.findFirst({
      where: { childId, status: GuardianChangeStatus.SUBMITTED },
    });
    if (enCours) {
      throw new ConflictException(
        'Une demande de changement de tuteur est déjà en cours d’examen.',
      );
    }

    const demande = await this.prisma.guardianChangeRequest.create({
      data: {
        childId,
        requestedParentPhone,
        requestedParentPhoneNormalized,
        reason,
        // Photographie du compteur AU MOMENT DE LA DEMANDE. C'est l'information
        // qui permet à l'administrateur de distinguer un cas de vie d'un
        // contournement — et elle doit être figée ici, parce que le compteur
        // continuera de bouger après.
        refusalCountAtRequest: child.parentalRefusalCount,
      },
    });

    await this.audit.record('GUARDIAN_CHANGE_REQUESTED', childId, {
      requestId: demande.id,
      refusalCountAtRequest: child.parentalRefusalCount,
      // Ni le numéro demandé ni la justification ne sont recopiés au journal :
      // ce sont des données personnelles, et l'identifiant de la demande suffit
      // à retrouver la ligne. Le journal dit QUE, la table dit QUOI.
    });

    return { id: demande.id, status: demande.status };
  }

  // --- Ce que le mineur voit de sa propre demande ---------------------------
  async mine(childId: string) {
    const demandes = await this.prisma.guardianChangeRequest.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      // PROJECTION EN LISTE BLANCHE, jamais une suppression de champs : un
      // champ ajouté demain à la table ne se retrouvera pas exposé par défaut.
      select: {
        id: true,
        requestedParentPhone: true,
        reason: true,
        status: true,
        // Le motif de la décision EST communiqué : une décision qu'on ne peut
        // pas connaître n'est pas opposable à quelqu'un.
        decisionReason: true,
        decidedAt: true,
        createdAt: true,
        // `decidedById` reste interne. Le mineur n'a pas à savoir QUEL
        // administrateur a tranché — le journal le sait, c'est suffisant, et
        // c'est ce qui protège l'agent d'une mise en cause personnelle.
      },
    });
    return demandes;
  }

  // --- Ce que l'administration voit ----------------------------------------
  async listPending() {
    return this.prisma.guardianChangeRequest.findMany({
      where: { status: GuardianChangeStatus.SUBMITTED },
      // Ordre EXPLICITE : la plus ancienne d'abord. Sans `orderBy`, PostgreSQL
      // rend les lignes dans l'ordre qui l'arrange, et une demande pourrait
      // rester invisible en bas d'une file qu'on croit traiter dans l'ordre.
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        childId: true,
        requestedParentPhone: true,
        reason: true,
        refusalCountAtRequest: true,
        createdAt: true,
        child: {
          select: {
            lsId: true,
            parentalRefusalCount: true,
            lastParentalRefusalAt: true,
            parentalRequestBlockedUntil: true,
          },
        },
      },
    });
  }

  // --- C2 / C3 : la décision ------------------------------------------------
  async decide(
    adminId: string,
    requestId: string,
    approve: boolean,
    decisionReason: string,
  ) {
    const demande = await this.prisma.guardianChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!demande) throw new NotFoundException('Demande introuvable.');
    if (demande.status !== GuardianChangeStatus.SUBMITTED) {
      throw new ConflictException('Cette demande a déjà été tranchée.');
    }

    const status = approve
      ? GuardianChangeStatus.APPROVED
      : GuardianChangeStatus.REJECTED;

    await this.prisma.$transaction(async (tx) => {
      await tx.guardianChangeRequest.update({
        where: { id: requestId },
        data: {
          status,
          decisionReason,
          decidedById: adminId,
          decidedAt: new Date(),
        },
      });

      if (approve) {
        // ====================================================================
        // CE QU'UNE APPROBATION FAIT, ET CE QU'ELLE NE FAIT PAS
        //
        // ELLE FAIT : créer une EXCEPTION NOMINATIVE au délai en cours. La
        // ligne passée en APPROVED, non consommée, autorise `requestConsent` à
        // présenter une demande AU NUMÉRO QU'ELLE PORTE, et à lui seul.
        //
        // ELLE NE TOUCHE PLUS À `parentalRequestBlockedUntil`. Défaut trouvé en
        // revue le 2026-08-08 : le remettre à NULL levait le délai pour
        // n'importe quel numéro, y compris celui du tuteur qui venait de
        // refuser. L'administrateur croyait autoriser un changement de
        // représentant légal ; il rouvrait en fait la porte à celui qu'on
        // venait de lui fermer.
        //
        // ELLE NE FAIT PAS : remettre `parentalRefusalCount` à zéro. Le
        // compteur est l'historique des refus, pas une punition qu'on lève. Le
        // remettre à zéro rendrait la procédure de changement de tuteur
        // strictement plus avantageuse que la patience — c'est-à-dire qu'elle
        // deviendrait le contournement qu'elle est censée empêcher.
        //
        // ELLE NE FAIT PAS NON PLUS : créer le lien vers le nouveau tuteur.
        // C'est `requestConsent` qui le fera, avec son SMS et sa confirmation.
        // Un administrateur autorise une démarche ; il ne consent pas à la
        // place d'un parent.
        // ====================================================================

        // Les autorisations antérieures non consommées sont PÉRIMÉES.
        //
        // Sans cela elles s'accumuleraient : un mineur qui obtient trois
        // approbations sur six mois, sans en utiliser aucune, disposerait de
        // trois exceptions simultanées à faire valoir plus tard. La dernière
        // décision de l'administration est celle qui compte.
        await tx.guardianChangeRequest.updateMany({
          where: {
            childId: demande.childId,
            status: GuardianChangeStatus.APPROVED,
            consumedAt: null,
            id: { not: requestId },
          },
          data: { consumedAt: new Date() },
        });
      }
    });

    // Deux événements DISTINCTS, et pas un seul avec un drapeau : une
    // approbation et un rejet ne se relisent pas de la même façon six mois plus
    // tard, et un filtre sur `action` doit pouvoir les séparer.
    await this.audit.record(
      approve ? 'GUARDIAN_CHANGE_APPROVED' : 'GUARDIAN_CHANGE_REJECTED',
      adminId,
      {
        requestId,
        childId: demande.childId,
        refusalCountAtRequest: demande.refusalCountAtRequest,
      },
    );

    return { id: requestId, status };
  }
}
