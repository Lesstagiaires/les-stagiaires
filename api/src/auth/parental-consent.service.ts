import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import {
  AccountStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';

@Injectable()
export class ParentalConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly audit: AuditService,
  ) {}

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  // Le lien de décision envoyé au parent.
  //
  // Il ne porte QUE l'identifiant du lien — ni le nom de l'enfant, ni son
  // numéro, ni rien qui subsisterait dans un historique de navigation ou dans
  // les journaux d'un relais SMS. Seul, il ne suffit pas : l'écran réclame le
  // code, qui prouve la possession du téléphone.
  //
  // En production, le garde-fou de démarrage refuse une APP_PUBLIC_URL locale
  // ou non chiffrée — un lien mort dans un SMS ne se rattrape pas.
  private buildConsentLink(linkId: string): string {
    const baseUrl = this.config.get<string>(
      'APP_PUBLIC_URL',
      'http://localhost:3000',
    );
    return `${baseUrl}/consent/${linkId}`;
  }

  // Le parent/tuteur n'a pas besoin d'un compte existant : le téléphone déclaré par le
  // mineur est la seule source de vérité de la demande (CLAUDE.md §5).
  async requestConsent(childId: string, parentPhone: string) {
    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: childId },
    });
    if (!child.isMinor) {
      throw new BadRequestException(
        'Le consentement parental ne concerne que les comptes mineurs.',
      );
    }
    // Un mineur ne peut jamais se déclarer comme son propre parent/tuteur — sinon il
    // recevrait le code de consentement lui-même et pourrait s'auto-valider, ce qui
    // annulerait la protection (CLAUDE.md §5).
    if (parentPhone === child.phone) {
      throw new BadRequestException(
        'Le numéro du parent/tuteur ne peut pas être le même que celui du compte mineur.',
      );
    }

    const ttlHours = Number(
      this.config.get<string>('PARENTAL_CONSENT_TTL_HOURS', '72'),
    );
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const consentExpiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const existing = await this.prisma.parentalLink.findUnique({
      where: { childId_parentPhone: { childId, parentPhone } },
    });

    // ========================================================================
    // LE DÉLAI DE GARDE DE LA RELANCE
    //
    // Une relance est indispensable : sans elle, un compte reste bloqué pour
    // toujours dès que le premier SMS se perd. Mais une relance sans garde-fou
    // est une arme, et le pire des trois risques n'est pas celui qu'on imagine
    // en écrivant un bouton « renvoyer » :
    //
    //   — LE PARENT. Un adolescent contrarié qui appuie vingt fois transforme
    //     la plateforme en outil de harcèlement du numéro qu'il a lui-même
    //     déclaré.
    //   — L'ARGENT. Chaque envoi est facturé par l'opérateur.
    //   — LE CODE. Relancer invalide le précédent. Un parent qui lit le SMS
    //     pendant que son enfant en demande un autre saisit un code déjà mort,
    //     et conclut que la plateforme ne fonctionne pas.
    //
    // La limitation de débit HTTP ne remplace pas ce contrôle : elle porte sur
    // une adresse IP et une minute, alors que la règle porte sur un LIEN
    // parental et se compte en minutes.
    // ========================================================================
    const cooldownMinutes = Number(
      this.config.get<string>('PARENTAL_CONSENT_RESEND_COOLDOWN_MINUTES', '3'),
    );
    if (existing?.lastConsentSentAt) {
      const ecoule = Date.now() - existing.lastConsentSentAt.getTime();
      const reste = cooldownMinutes * 60_000 - ecoule;
      if (reste > 0) {
        throw new ConflictException(
          `Un SMS vient d'être envoyé. Merci d'attendre ${Math.ceil(reste / 60_000)} minute(s) avant de relancer.`,
        );
      }
    }

    // ========================================================================
    // CHANGER DE PARENT REBLOQUE LE COMPTE
    //
    // Défaut corrigé le 2026-08-07. Demander le consentement d'un NOUVEAU
    // numéro créait bien un lien PENDING — mais laissait l'ancien lien ACTIVE.
    // Or le contrôle d'accès cherche `findFirst({ status: ACTIVE })` : il
    // trouvait l'ancien, et laissait tout passer.
    //
    // Autrement dit, un mineur pouvait faire valider son compte par un adulte
    // complaisant, puis « changer de parent » sans aucune conséquence : le
    // nouveau numéro ne recevait qu'un code sans portée. C'est exactement la
    // « modification silencieuse » que le cahier des charges interdit.
    //
    // On révoque donc les liens actifs vers d'AUTRES numéros avant d'ouvrir le
    // nouveau cycle. Le compte retombe en attente, ce qui est le sens voulu :
    // un changement de tuteur est un fait qui se reconfirme.
    // ========================================================================
    const autresLiensActifs = await this.prisma.parentalLink.findMany({
      where: {
        childId,
        status: ParentalLinkStatus.ACTIVE,
        parentPhone: { not: parentPhone },
      },
    });

    for (const ancien of autresLiensActifs) {
      await this.prisma.parentalLink.update({
        where: { id: ancien.id },
        data: { status: ParentalLinkStatus.REVOKED },
      });
      await this.audit.record('PARENTAL_LINK_REVOKED_ON_CHANGE', childId, {
        linkId: ancien.id,
        // Le numéro n'est PAS journalisé : c'est une donnée personnelle, et
        // l'identifiant du lien suffit à retrouver la ligne.
        raison: 'Nouveau parent/tuteur déclaré par le titulaire du compte.',
      });
    }

    if (autresLiensActifs.length > 0) {
      // Le compte redevient restreint tant que le nouveau tuteur n'a pas
      // confirmé — sinon la révocation ne changerait rien à ce qu'il peut faire.
      await this.prisma.user.update({
        where: { id: childId },
        data: { status: AccountStatus.AWAITING_PARENTAL_CONSENT },
      });
    }

    if (existing?.status === ParentalLinkStatus.ACTIVE) {
      throw new ConflictException(
        'Ce parent/tuteur a déjà confirmé le rattachement.',
      );
    }

    const link = existing
      ? await this.prisma.parentalLink.update({
          where: { id: existing.id },
          data: {
            status: ParentalLinkStatus.PENDING,
            consentCodeHash: this.hashCode(code),
            consentExpiresAt,
            consentAttempts: 0,
            flaggedAt: null,
            lastConsentSentAt: new Date(),
          },
        })
      : await this.prisma.parentalLink.create({
          data: {
            childId,
            parentPhone,
            consentCodeHash: this.hashCode(code),
            consentExpiresAt,
            lastConsentSentAt: new Date(),
          },
        });

    // ========================================================================
    // LE PARENT AGIT LUI-MÊME — IL NE TRANSMET PLUS UN CODE
    //
    // L'ancien message disait « communiquez-lui ce code ». Le consentement
    // était donc donné par L'ENFANT, qui tapait un code que son parent lui
    // avait dicté. C'est précisément ce que le cahier des charges refuse :
    // « une action positive et traçable de sa part », pas une délégation.
    //
    // Et un parent qui ne peut que transmettre un code ne peut pas REFUSER.
    // Le refus n'avait aucune surface, quel que soit le code écrit au serveur.
    //
    // Le message porte donc un LIEN vers l'écran de décision — accepter ou
    // refuser — et le code qui prouve la possession du téléphone. Les deux sont
    // nécessaires : le lien dit DE QUELLE demande il s'agit, le code prouve que
    // c'est bien ce téléphone qui répond.
    // ========================================================================
    await this.sms.send(
      parentPhone,
      `LES STAGIAIRES : votre enfant (${child.phone}) vous a désigné comme parent/tuteur pour son inscription sur notre plateforme de stages. Pour donner ou refuser votre accord : ${this.buildConsentLink(link.id)} — votre code : ${code}. Sans réponse, son compte reste en mode restreint (candidature, convention et partage de documents bloqués).`,
    );

    await this.audit.record('PARENTAL_CONSENT_REQUESTED', childId, {
      linkId: link.id,
    });
    return { linkId: link.id, status: link.status };
  }

  async confirmConsent(linkId: string, code: string) {
    const link = await this.prisma.parentalLink.findUnique({
      where: { id: linkId },
    });
    if (!link)
      throw new NotFoundException('Demande de consentement introuvable.');
    if (link.status === ParentalLinkStatus.ACTIVE) {
      throw new BadRequestException('Ce consentement a déjà été confirmé.');
    }
    if (
      !link.consentCodeHash ||
      !link.consentExpiresAt ||
      link.consentExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('Code invalide ou expiré.');
    }
    if (link.consentAttempts >= link.maxConsentAttempts) {
      throw new UnauthorizedException('Nombre maximal de tentatives atteint.');
    }

    // Comparaison en temps constant (CLAUDE.md §2).
    const isMatch = timingSafeEqual(
      Buffer.from(link.consentCodeHash),
      Buffer.from(this.hashCode(code)),
    );
    if (!isMatch) {
      await this.prisma.parentalLink.update({
        where: { id: link.id },
        data: { consentAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    // Rattachement au compte du parent seulement s'il en a déjà un — jamais requis
    // pour que le consentement soit valide (CLAUDE.md §5 : limite assumée du MVP).
    const matchingParent = await this.prisma.user.findUnique({
      where: { phone: link.parentPhone },
    });
    // Un compte déjà enregistré comme mineur ne peut jamais servir de "parent" — même
    // si le code a été reçu sur ce numéro (deux mineurs ne doivent pas pouvoir
    // s'auto-valider mutuellement, CLAUDE.md §5).
    if (matchingParent?.isMinor) {
      throw new BadRequestException(
        'Le numéro déclaré correspond à un compte mineur — il ne peut pas donner de consentement parental.',
      );
    }

    await this.prisma.parentalLink.update({
      where: { id: link.id },
      data: {
        status: ParentalLinkStatus.ACTIVE,
        confirmedAt: new Date(),
        parentId: matchingParent?.id,
        consentCodeHash: null,
      },
    });

    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: link.childId },
    });
    if (child.status === AccountStatus.AWAITING_PARENTAL_CONSENT) {
      await this.prisma.user.update({
        where: { id: child.id },
        data: { status: AccountStatus.ACTIVE },
      });
    }

    await this.audit.record('PARENTAL_CONSENT_CONFIRMED', link.childId, {
      linkId: link.id,
    });
    return { message: 'Consentement confirmé.' };
  }

  // ==========================================================================
  // LE PARENT REFUSE — CE QUI N'EST PAS LA MÊME CHOSE QUE NE PAS RÉPONDRE
  //
  // Exigence du cahier des charges : « prévoir un état où le parent peut
  // refuser (pas seulement ignorer) — le compte reste alors bloqué au-delà du
  // délai de 30 jours, sans attendre l'expiration automatique ».
  //
  // Jusqu'ici le silence et le refus se confondaient : dans les deux cas le
  // compte restait ouvert en mode restreint pendant trente jours. Un parent
  // qui prend la peine de répondre NON dit quelque chose de plus fort que
  // celui qui n'a rien vu passer, et le système n'avait pas de mot pour
  // l'entendre.
  //
  // LE MÊME CODE QUE POUR CONFIRMER. Refuser exige de prouver qu'on détient le
  // téléphone, exactement comme accepter — sinon n'importe qui pourrait
  // bloquer le compte d'un mineur en connaissant son identifiant de lien.
  // ==========================================================================
  async declineConsent(linkId: string, code: string) {
    const link = await this.prisma.parentalLink.findUnique({
      where: { id: linkId },
    });
    if (!link)
      throw new NotFoundException('Demande de consentement introuvable.');
    if (link.status === ParentalLinkStatus.DECLINED) {
      throw new BadRequestException('Ce consentement a déjà été refusé.');
    }
    if (
      !link.consentCodeHash ||
      !link.consentExpiresAt ||
      link.consentExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('Code invalide ou expiré.');
    }
    if (link.consentAttempts >= link.maxConsentAttempts) {
      throw new UnauthorizedException('Nombre maximal de tentatives atteint.');
    }

    // Comparaison en temps constant, comme pour la confirmation (CLAUDE.md §2).
    const isMatch = timingSafeEqual(
      Buffer.from(link.consentCodeHash),
      Buffer.from(this.hashCode(code)),
    );
    if (!isMatch) {
      await this.prisma.parentalLink.update({
        where: { id: link.id },
        data: { consentAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code invalide ou expiré.');
    }

    await this.prisma.parentalLink.update({
      where: { id: link.id },
      data: {
        status: ParentalLinkStatus.DECLINED,
        declinedAt: new Date(),
        // Le code est consommé : un refus ne se rejoue pas, et ne se
        // retransforme pas en acceptation avec le même secret.
        consentCodeHash: null,
      },
    });

    // BLOCAGE IMMÉDIAT, sans attendre les trente jours. C'est toute la
    // différence entre un refus et un silence.
    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: link.childId },
    });
    if (child.status !== AccountStatus.DEACTIVATED) {
      await this.prisma.user.update({
        where: { id: child.id },
        data: { status: AccountStatus.DEACTIVATED, deactivatedAt: new Date() },
      });
    }

    await this.audit.record('PARENTAL_CONSENT_DECLINED', link.childId, {
      linkId: link.id,
    });

    // Aucune raison n'est demandée au parent, et aucune ne serait transmise au
    // mineur : un motif libre finirait par circuler entre eux via la
    // plateforme, ce qui n'est pas son rôle.
    return { message: 'Refus enregistré.' };
  }

  // ==========================================================================
  // CE QUE LE PARENT VOIT AVANT DE DÉCIDER
  //
  // « Le message doit expliquer ce qu'est LES STAGIAIRES et ce que le mineur a
  // renseigné. » Un parent à qui l'on demande d'approuver sans rien montrer
  // n'approuve rien : il clique.
  //
  // PUBLIQUE, donc RÉDUITE AU STRICT NÉCESSAIRE. L'identifiant de lien est
  // imprévisible et n'existe que dans le SMS du parent, mais cette réponse
  // reste lisible par quiconque l'obtiendrait. On ne sort donc que le prénom et
  // un numéro masqué — de quoi reconnaître son enfant, rien de plus. Ni nom de
  // famille, ni date de naissance, ni ville, ni adresse.
  //
  // Construite par LISTE BLANCHE : un champ ajouté demain au modèle ne se
  // retrouvera pas ici par accident.
  // ==========================================================================
  async describeForParent(linkId: string) {
    const link = await this.prisma.parentalLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        status: true,
        consentExpiresAt: true,
        child: { select: { firstName: true, phone: true } },
      },
    });
    if (!link)
      throw new NotFoundException('Demande de consentement introuvable.');

    const expire = !link.consentExpiresAt || link.consentExpiresAt < new Date();

    return {
      linkId: link.id,
      childFirstName: link.child.firstName,
      childPhoneMasked: this.maskPhone(link.child.phone),
      status: link.status,
      // L'écran a besoin de savoir s'il doit encore proposer des boutons, ou
      // simplement rendre compte d'une décision déjà prise.
      isActionable: link.status === ParentalLinkStatus.PENDING && !expire,
    };
  }

  // Les quatre derniers chiffres suffisent à un parent pour reconnaître le
  // numéro de son enfant, sans le divulguer à qui lirait cette réponse.
  private maskPhone(phone: string | null): string | null {
    if (!phone) return null;
    return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
  }

  // ==========================================================================
  // CE QUE LE MINEUR VOIT DE SA PROPRE DEMANDE
  //
  // Il ne voyait rien : ni où en était la demande, ni quand le code expire, ni
  // comment relancer. Un compte pouvait donc rester bloqué sans que son
  // titulaire — un mineur — comprenne pourquoi. C'est le sens de ce parcours.
  //
  // `consentExpiresAt` et `declinedAt` manquaient à la projection. Sans le
  // premier, impossible de dire « le code expire demain » ; sans le second,
  // impossible de distinguer un refus d'un silence.
  //
  // JAMAIS `consentCodeHash` : c'est un secret de vérification, pas une donnée
  // consultable, même par le titulaire du compte (CLAUDE.md §6). Le mineur
  // n'est pas censé connaître le code de son parent — sinon il consentirait à
  // sa place, ce que tout ce dispositif cherche à empêcher.
  //
  // `parentPhone` EN CLAIR est assumé : c'est le mineur qui l'a saisi, et il
  // doit pouvoir vérifier qu'il ne s'est pas trompé de chiffre avant de
  // relancer. Le masquer l'empêcherait de corriger la seule erreur qu'il puisse
  // corriger seul.
  // ==========================================================================
  async listForChild(childId: string) {
    const cooldownMinutes = Number(
      this.config.get<string>('PARENTAL_CONSENT_RESEND_COOLDOWN_MINUTES', '3'),
    );

    const links = await this.prisma.parentalLink.findMany({
      where: { childId },
      select: {
        id: true,
        childId: true,
        parentPhone: true,
        parentId: true,
        status: true,
        consentAttempts: true,
        maxConsentAttempts: true,
        consentExpiresAt: true,
        flaggedAt: true,
        declinedAt: true,
        lastConsentSentAt: true,
        createdAt: true,
        confirmedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const maintenant = Date.now();
    return links.map((link) => ({
      ...link,
      // Deux états que l'écran devrait sinon recalculer — et recalculer un délai
      // côté client, c'est le recalculer avec l'horloge du téléphone, qui peut
      // être fausse de plusieurs heures.
      codeExpired:
        link.status === ParentalLinkStatus.PENDING &&
        (!link.consentExpiresAt ||
          link.consentExpiresAt.getTime() < maintenant),
      resendAvailableAt: link.lastConsentSentAt
        ? new Date(link.lastConsentSentAt.getTime() + cooldownMinutes * 60_000)
        : null,
    }));
  }
}
