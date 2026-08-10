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
  GuardianChangeStatus,
  ParentalLinkStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import { CountryPolicyService } from './country-policy.service';
import { MinorPolicyService } from './minor-policy.service';
import { isSameParentPhone, normalizeParentPhone } from './parental-phone';
import type { SmsProvider } from '../sms/sms-provider.interface';

@Injectable()
export class ParentalConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly audit: AuditService,
    private readonly minorPolicy: MinorPolicyService,
    private readonly countryPolicies: CountryPolicyService,
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

    // ========================================================================
    // LA MAJORITÉ EST RECALCULÉE, JAMAIS LUE DANS UN DRAPEAU
    //
    // `User.isMinor` est écrit à l'inscription et ne bouge plus : un jeune
    // inscrit à 17 ans le reste indéfiniment. Le palier vient donc de la
    // politique du pays, comme partout ailleurs depuis la correction du
    // 2026-08-07.
    //
    // À dix-huit ans, tout ce cycle devient sans objet — y compris un compteur
    // de refus à trois. Le compteur ne disparaît pas, il devient INERTE.
    // ========================================================================
    if (!(await this.minorPolicy.requiresParentalConsent(child))) {
      throw new BadRequestException(
        'Le consentement parental ne concerne que les comptes mineurs.',
      );
    }

    // LA NORMALISATION D'ABORD. Tout ce qui suit — délai de garde, compteur,
    // détection d'un changement de tuteur — s'indexe sur cette forme. Sur la
    // forme brute, une simple variation d'espacement les contournait tous.
    const parentPhoneNormalized = normalizeParentPhone(parentPhone);

    // ========================================================================
    // LE BLOCAGE APRÈS REFUS
    //
    // « 1er refus : 7 jours. 2e : 30 jours. 3e : 6 mois, réarmés à chaque
    // refus suivant. » Le refus n'est jamais définitif — mais il coûte de plus
    // en plus cher d'insister.
    //
    // Contrôlé AVANT le délai de garde de trois minutes : c'est la règle la
    // plus forte, et l'utilisateur doit voir le vrai motif, pas un message de
    // relance trop rapide qui masquerait le fond.
    // ========================================================================
    const bloque =
      !!child.parentalRequestBlockedUntil &&
      child.parentalRequestBlockedUntil > new Date();

    // ========================================================================
    // L'EXCEPTION NOMINATIVE AU BLOCAGE
    //
    // Défaut trouvé en revue le 2026-08-08. L'approbation d'un changement de
    // tuteur remettait `parentalRequestBlockedUntil` à NULL, sans aucun lien
    // avec le numéro approuvé : l'administrateur croyait autoriser un
    // changement de représentant légal, et levait en réalité le délai pour
    // N'IMPORTE QUEL numéro — y compris celui du tuteur qui venait de refuser.
    //
    // Le blocage n'est donc plus jamais levé. Une approbation crée une
    // AUTORISATION NOMINATIVE : « ce numéro-là, et lui seul, peut recevoir une
    // demande malgré le délai en cours ».
    //
    // LA RECHERCHE PORTE SUR LA FORME CANONIQUE. C'est ce qui ferme le
    // contournement : soumettre ensuite un autre numéro que celui approuvé ne
    // trouve aucune autorisation, et une variation d'écriture du numéro
    // approuvé en trouve bien une.
    //
    // L'ancien tuteur qui a refusé ne peut jamais faire l'objet d'une telle
    // autorisation : `GuardianChangeService.request()` refuse toute demande
    // portant sur un numéro déjà rattaché au compte.
    // ========================================================================
    const autorisation = bloque
      ? await this.prisma.guardianChangeRequest.findFirst({
          where: {
            childId,
            requestedParentPhoneNormalized: parentPhoneNormalized,
            status: GuardianChangeStatus.APPROVED,
            consumedAt: null,
          },
          // La plus récente, et l'ordre est EXPLICITE : sans `orderBy`,
          // PostgreSQL rend la ligne qui l'arrange, et deux exécutions
          // identiques pourraient ne pas retenir la même autorisation.
          orderBy: { decidedAt: 'desc' },
        })
      : null;

    if (bloque && !autorisation) {
      // La TENTATIVE est journalisée, pas seulement le refus lui-même.
      //
      // C'est l'un des six événements distincts demandés le 2026-08-08. Sans
      // lui, le journal montre un mineur qui a fait trois demandes en six mois ;
      // avec lui, il montre éventuellement un mineur qui a essayé quarante fois
      // en une semaine. Ce n'est pas la même personne, et ce n'est pas la même
      // situation à traiter.
      await this.audit.record('PARENTAL_CONSENT_REQUEST_BLOCKED', childId, {
        blockedUntil: child.parentalRequestBlockedUntil!.toISOString(),
        refusalCount: child.parentalRefusalCount,
      });
      throw new ConflictException(
        `Une nouvelle demande ne pourra être présentée qu'à partir du ${child.parentalRequestBlockedUntil!.toLocaleDateString('fr-FR')}.`,
      );
    }

    if (autorisation) {
      // Une demande qui ne passe QUE grâce à une décision d'administrateur doit
      // se distinguer d'une demande ordinaire dans le journal. Sans cet
      // événement, une relecture ultérieure verrait une demande présentée
      // pendant un délai de garde sans pouvoir dire ce qui l'a permise.
      await this.audit.record(
        'PARENTAL_CONSENT_REQUESTED_UNDER_AUTHORIZATION',
        childId,
        {
          guardianChangeRequestId: autorisation.id,
          blockedUntil: child.parentalRequestBlockedUntil!.toISOString(),
          refusalCount: child.parentalRefusalCount,
        },
      );
    }

    // Un mineur ne peut jamais se déclarer comme son propre parent/tuteur —
    // sinon il recevrait le code lui-même et s'auto-validerait, ce qui annule
    // toute la protection (CLAUDE.md §5).
    //
    // La comparaison passe par la forme canonique DES DEUX CÔTÉS. Comparer le
    // numéro normalisé du parent au `phone` brut du compte laissait passer le
    // même téléphone écrit autrement — c'est-à-dire exactement le contournement
    // que ce contrôle existe pour fermer.
    if (isSameParentPhone(parentPhone, child.phone)) {
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
      where: {
        childId_parentPhoneNormalized: { childId, parentPhoneNormalized },
      },
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
        parentPhoneNormalized: { not: parentPhoneNormalized },
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
            // `declinedAt` n'est PAS effacé : c'est lui qui dira au tuteur, dans
            // le SMS, qu'il s'agit d'une nouvelle demande après son refus.
            // L'effacer reviendrait à lui présenter la relance comme un premier
            // contact — ce qu'il vivrait comme un refus ignoré.
          },
        })
      : await this.prisma.parentalLink.create({
          data: {
            childId,
            parentPhone,
            parentPhoneNormalized,
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
    // ========================================================================
    // UNE RELANCE APRÈS REFUS SE DIT
    //
    // Arbitrage du promoteur : « le message doit rester neutre et respectueux :
    // il ne doit pas culpabiliser le parent ni donner l'impression que son
    // premier refus a été ignoré. »
    //
    // Un parent qui reçoit le même message qu'il y a une semaine, sans
    // contexte, croit à un bogue — ou pire, à un contournement.
    // ========================================================================
    const estRelanceApresRefus = !!existing?.declinedAt;

    await this.sms.send(
      // On COMPOSE la forme canonique, pas la saisie brute. L'opérateur
      // accepterait sans doute « +237 690 00 11 11 », mais rien ne le garantit,
      // et un SMS non remis bloquerait le compte sans que personne ne le sache.
      parentPhoneNormalized,
      estRelanceApresRefus
        ? `LES STAGIAIRES : votre enfant (${child.phone}) sollicite à nouveau votre accord pour son inscription sur notre plateforme de stages. Vous aviez refusé une précédente demande, et votre décision a bien été enregistrée. Pour donner ou refuser votre accord : ${this.buildConsentLink(link.id)} — votre code : ${code}.`
        : `LES STAGIAIRES : votre enfant (${child.phone}) vous a désigné comme parent/tuteur pour son inscription sur notre plateforme de stages. Pour donner ou refuser votre accord : ${this.buildConsentLink(link.id)} — votre code : ${code}. Sans réponse, son compte reste en mode restreint (candidature, convention et partage de documents bloqués).`,
    );

    await this.audit.record('PARENTAL_CONSENT_REQUESTED', childId, {
      linkId: link.id,
    });
    return { linkId: link.id, status: link.status };
  }

  // ==========================================================================
  // L'AUTORISATION S'ÉTEINT QUAND LA DÉCISION ARRIVE
  //
  // Et pas quand la demande part. C'est le point qui n'est pas évident.
  //
  // Consommée au premier envoi, l'autorisation enfermerait le mineur dès qu'un
  // SMS se perd : il ne pourrait plus relancer le tuteur que l'administrateur
  // vient pourtant d'autoriser, et devrait redéposer un dossier pour un message
  // égaré par l'opérateur. Elle vaut donc « droit d'obtenir une décision de ce
  // tuteur », et se referme sur cette décision — acceptation ou refus.
  //
  // Conséquence voulue : si le nouveau tuteur refuse à son tour, le compteur
  // passe à n+1, un nouveau délai se pose, et il ne reste AUCUNE autorisation
  // vivante. Il faut repasser devant un administrateur. Le changement de tuteur
  // ne s'use jamais en droit de contournement répétable.
  // ==========================================================================
  private async consumeAuthorization(
    childId: string,
    parentPhoneNormalized: string,
  ): Promise<void> {
    const autorisation = await this.prisma.guardianChangeRequest.findFirst({
      where: {
        childId,
        requestedParentPhoneNormalized: parentPhoneNormalized,
        status: GuardianChangeStatus.APPROVED,
        consumedAt: null,
      },
      orderBy: { decidedAt: 'desc' },
    });
    if (!autorisation) return;

    await this.prisma.guardianChangeRequest.update({
      where: { id: autorisation.id },
      data: { consumedAt: new Date() },
    });
    await this.audit.record('GUARDIAN_CHANGE_AUTHORIZATION_CONSUMED', childId, {
      guardianChangeRequestId: autorisation.id,
    });
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

    // La décision est arrivée : l'autorisation éventuelle a rempli son office.
    await this.consumeAuthorization(link.childId, link.parentPhoneNormalized);

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

    // ========================================================================
    // L'ÂGE SE RECALCULE AU MOMENT DE LA DÉCISION, PAS DE LA DEMANDE
    //
    // Écart relevé en revue le 2026-08-08 : `requestConsent` recalculait le
    // palier, `declineConsent` non. Un parent qui répondait après l'anniversaire
    // des dix-huit ans de son enfant écrivait donc encore un compteur et un
    // délai de blocage — sur un compte devenu majeur, pour lequel plus aucune
    // demande de consentement n'est recevable.
    //
    // Ces écritures étaient inertes, jamais relues. Mais un cycle de refus qui
    // continue de tourner à vide sur un compte majeur est une contradiction
    // qu'un lecteur du journal ne saurait pas interpréter — et une donnée
    // inutile conservée sur un compte, ce que le cahier des charges proscrit.
    //
    // LE CONTRÔLE EST PLACÉ AVANT TOUTE ÉCRITURE. Placé après la mise à jour du
    // lien, il aurait laissé un lien DECLINED derrière lui à chaque refus tardif.
    // ========================================================================
    const child = await this.prisma.user.findUniqueOrThrow({
      where: { id: link.childId },
    });

    if (!(await this.minorPolicy.requiresParentalConsent(child))) {
      throw new BadRequestException(
        "Cette demande n'a plus d'objet : le titulaire du compte a atteint la majorité.",
      );
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

    // ========================================================================
    // LE COMPTEUR, ET LE DÉLAI QU'IL DÉTERMINE
    //
    // Modèle validé le 2026-08-08. Le compteur vit sur le MINEUR : porté par le
    // lien, il se remettrait à zéro à la première nouvelle demande, puisque la
    // même ligne est réutilisée.
    //
    // Il ne se décrémente jamais, et rien d'autre que ce bloc ne l'écrit — ni
    // une nouvelle demande, ni une décision d'administrateur, ni l'arrivée à la
    // majorité.
    // ========================================================================
    // `child` a déjà été chargé plus haut, pour le contrôle de majorité : une
    // seconde lecture donnerait deux photographies du même compte, et le jour
    // où quelque chose s'écrirait entre les deux, le compteur incrémenté ne
    // serait plus celui qui a été vérifié.
    const refusalCount = child.parentalRefusalCount + 1;
    const policy = await this.countryPolicies.resolve(
      child.countryOfResidence ?? '',
    );
    const delaiJours =
      refusalCount === 1
        ? policy.refusalDelay1Days
        : refusalCount === 2
          ? policy.refusalDelay2Days
          : policy.refusalDelayFinalDays;
    const blockedUntil = new Date(
      Date.now() + delaiJours * 24 * 60 * 60 * 1000,
    );

    // ========================================================================
    // LE COMPTE RESTE RESTREINT — IL N'EST PAS DÉSACTIVÉ
    //
    // Correction du modèle, arbitrée le 2026-08-08. Le refus mettait le compte
    // en DEACTIVATED, ce qui INTERDIT LA CONNEXION. Or le mineur doit pouvoir
    // accéder pendant tout le blocage à la présentation pédagogique destinée à
    // son tuteur : les deux règles se contredisaient.
    //
    // AWAITING_PARENTAL_CONSENT bloque déjà exactement ce qu'il faut —
    // candidature, acceptation, signature, mobilité, partage du Coffre-fort,
    // abonnement financé — et laisse la navigation, le profil et les brouillons.
    // C'est ce que le cahier des charges appelle « bloqué ».
    //
    // DEACTIVATED reste réservé au SILENCE de trente jours, qui est un cas
    // différent : personne n'a répondu.
    // ========================================================================
    await this.prisma.user.update({
      where: { id: child.id },
      data: {
        status: AccountStatus.AWAITING_PARENTAL_CONSENT,
        parentalRefusalCount: refusalCount,
        lastParentalRefusalAt: new Date(),
        parentalRequestBlockedUntil: blockedUntil,
      },
    });

    // La décision est arrivée : l'autorisation éventuelle s'éteint ici.
    //
    // C'est ce qui empêche une approbation d'administrateur de servir deux
    // fois. Après ce refus, le compte est bloqué pour `delaiJours` et il ne
    // reste plus aucune exception vivante — y compris pour ce tuteur-ci.
    await this.consumeAuthorization(link.childId, link.parentPhoneNormalized);

    await this.audit.record('PARENTAL_CONSENT_DECLINED', link.childId, {
      linkId: link.id,
      // Le compteur et le délai au journal : c'est ce qui permet de
      // reconstituer l'historique sans faire confiance à la dénormalisation
      // portée par User.
      refusalCount,
      blockedUntil: blockedUntil.toISOString(),
      delaiJours,
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

    // ========================================================================
    // LA SITUATION DÉRIVÉE — état B de la machine validée le 2026-08-08
    //
    // Le blocage vit sur le COMPTE, pas sur le lien : il survit à un changement
    // de tuteur, et c'est tout son intérêt. Il est donc renvoyé à côté de la
    // liste, et non recopié dans chaque ligne.
    //
    // `canRequestNow` est CALCULÉ ICI, par le serveur. L'écran ne doit pas
    // comparer une date à l'horloge du téléphone — fausse de plusieurs heures
    // sur beaucoup d'appareils, et modifiable à la main par un mineur pressé.
    // ========================================================================
    const compte = await this.prisma.user.findUniqueOrThrow({
      where: { id: childId },
      select: {
        parentalRefusalCount: true,
        parentalRequestBlockedUntil: true,
      },
    });

    const maintenant = Date.now();
    const refusal = {
      count: compte.parentalRefusalCount,
      blockedUntil: compte.parentalRequestBlockedUntil,
      canRequestNow:
        !compte.parentalRequestBlockedUntil ||
        compte.parentalRequestBlockedUntil.getTime() <= maintenant,
    };

    const enrichis = links.map((link) => ({
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

    return { links: enrichis, refusal };
  }
}
