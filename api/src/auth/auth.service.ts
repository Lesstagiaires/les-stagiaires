import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AmbassadorsService } from '../ambassadors/ambassadors.service';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  AccountStatus,
  MinorGatedAction,
  OtpPurpose,
  UserPath,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PARCOURS_INITIAL, ROLE_INITIAL } from './derivation-intention';
import { generateLsIdCandidate } from '../common/ls-id/ls-id.util';
import {
  condensatFactice,
  prechaufferCondensatFactice,
} from './condensat-factice';
import {
  LOGIN_THROTTLE,
  type LoginThrottle,
} from './login-throttle/login-throttle.interface';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER } from '../sms/sms-provider.interface';
import type { SmsProvider } from '../sms/sms-provider.interface';
import { deriveDeviceLabel } from './device-label.util';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyLoginTwoFactorDto } from './dto/verify-login-two-factor.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateEmergencyContactDto } from './dto/update-emergency-contact.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { MinorPolicyService } from './minor-policy.service';
import { OtpService } from './otp.service';
import { ParentalConsentService } from './parental-consent.service';
import { TokenService } from './token.service';

const RETENTION_DAYS_BEFORE_HARD_DELETE = 30;

@Injectable()
export class AuthService implements OnModuleInit {
  // Le condensat factice est calculé au démarrage, pas à la première connexion :
  // sinon c'est le premier utilisateur de la journée qui paierait le coût
  // d'Argon2, et sa lenteur serait à son tour un signal.
  async onModuleInit(): Promise<void> {
    await prechaufferCondensatFactice();
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly parentalConsent: ParentalConsentService,
    private readonly ambassadors: AmbassadorsService,
    private readonly minorPolicy: MinorPolicyService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(LOGIN_THROTTLE) private readonly throttle: LoginThrottle,
  ) {}

  // --- FR-AUTH-001 / 002 / 003 : inscription, OTP, LS-ID ---------------------------------

  // V6-1 — attribution du rôle déduit de l'intention déclarée.
  //
  // LE FILTRE `selfAssignable` EST LA GARANTIE, PAS UN CONFORT. Il rend
  // structurellement impossible qu'une intention finisse par accorder un rôle
  // privilégié : même si quelqu'un ajoutait un jour `ADMIN` à la table de
  // dérivation, la recherche ne le trouverait pas et aucun rôle ne serait
  // attribué. La table ne peut donc pas devenir un chemin d'élévation.
  //
  // Un rôle introuvable n'échoue pas : l'inscription doit aboutir même si le
  // catalogue de rôles diverge de la table — le compte reste utilisable, sans
  // rôle, exactement comme une inscription sans intention.
  private async attribuerRoleInitial(
    userId: string,
    roleName: string,
  ): Promise<void> {
    const role = await this.prisma.role.findFirst({
      where: { name: roleName, selfAssignable: true },
      select: { id: true },
    });
    if (!role) return;

    await this.prisma.userRole.create({ data: { userId, roleId: role.id } });
  }

  async register(dto: RegisterDto) {
    const existingPhone = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existingPhone) {
      throw new ConflictException(
        'Ce numéro de téléphone est déjà associé à un compte.',
      );
    }
    if (dto.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existingEmail) {
        throw new ConflictException(
          'Cette adresse email est déjà associée à un compte.',
        );
      }
    }

    const dateOfBirth = new Date(dto.dateOfBirth);
    const countryOfResidence = dto.countryOfResidence.toUpperCase();

    // @IsPhoneNumber côté DTO garantit un E.164 valide pour UN pays quelconque, mais pas
    // que ce pays soit celui déclaré comme pays de résidence — un candidat pourrait sinon
    // déclarer le Cameroun avec un numéro sénégalais. Le mobile envoie déjà un numéro
    // reconstruit à partir du pays choisi (lib/countries.ts), mais l'API ne fait jamais
    // confiance au client : la même vérification est reproduite ici.
    const parsedPhone = parsePhoneNumberFromString(dto.phone);
    if (!parsedPhone?.isValid() || parsedPhone.country !== countryOfResidence) {
      throw new BadRequestException(
        'Le numéro de téléphone ne correspond pas à un numéro valide pour le pays de résidence déclaré.',
      );
    }

    // Âge minimum du pays déclaré — avant toute autre vérification (moteur de règles
    // CountryPolicy, jamais un seuil fixe, cahier des charges).
    await this.minorPolicy.assertMeetsMinimumAge(
      dateOfBirth,
      countryOfResidence,
    );

    const { isMinor } = await this.minorPolicy.classify(
      dateOfBirth,
      countryOfResidence,
    );
    const registrationGated = await this.minorPolicy.isActionGated(
      { dateOfBirth, countryOfResidence },
      MinorGatedAction.REGISTRATION,
    );

    // Le téléphone d'un parent/tuteur n'est requis que si l'inscription fait partie des
    // actions encadrées pour ce pays et cette tranche d'âge — jamais un seuil fixe de
    // 18 ans (CLAUDE.md §5, moteur de règles CountryPolicy).
    if (registrationGated && !dto.parentPhone) {
      throw new BadRequestException(
        "Le numéro de téléphone d'un parent ou tuteur est requis pour un compte de cet âge, dans ce pays.",
      );
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        sex: dto.sex,
        phone: dto.phone,
        email: dto.email,
        cityOfResidence: dto.cityOfResidence,
        countryOfResidence,
        password: passwordHash,
        language: dto.language,
        dateOfBirth,
        isMinor,
        status: AccountStatus.PENDING_VERIFICATION,
        // V6-1 — l'intention est facultative, et le rester est une décision :
        // aucune inscription ne doit échouer parce que l'utilisateur est arrivé
        // par un chemin qui n'en portait pas. Un compte sans intention est un
        // compte valide, dont le parcours reste « non déclaré ».
        initialIntent: dto.initialIntent ?? null,
        currentPath: dto.initialIntent
          ? PARCOURS_INITIAL[dto.initialIntent]
          : null,
      },
    });
    // Profil préreempli avec le nom déclaré à l'inscription — modifiable ensuite,
    // notamment pour les documents générés nommément (lettre d'admission, convention).
    await this.prisma.profile.create({
      data: { userId: user.id, fullName: `${dto.firstName} ${dto.lastName}` },
    });

    // V6-1 — le rôle DÉRIVE de l'intention, il n'est jamais choisi par le client.
    if (dto.initialIntent) {
      await this.attribuerRoleInitial(user.id, ROLE_INITIAL[dto.initialIntent]);
    }

    // Rattachement à un ambassadeur, si un code valide a été saisi. Définitif : un
    // filleul n'a qu'un parrain (contrainte d'unicité en base). Aucun droit à
    // commission n'en découle par lui-même — il faudra un paiement confirmé, plus
    // tard, pour que quoi que ce soit soit dû.
    // Un code non reconnu ne fait JAMAIS échouer l'inscription (décision du
    // promoteur), mais il n'est plus avalé en silence : le statut remonte au client,
    // qui prévient l'utilisateur. Sans ce retour, il croirait son parrain rattaché.
    const ambassadorAttribution = dto.ambassadorCode
      ? await this.ambassadors.attributeUser(user.id, dto.ambassadorCode)
      : null;

    await this.otp.generateAndSend(user.id, dto.phone, OtpPurpose.REGISTRATION);
    await this.audit.record('ACCOUNT_REGISTERED', user.id, {
      isMinor,
      countryOfResidence,
    });

    // Envoyé dès la saisie, en parallèle de l'OTP — jamais après coup
    // (FR-AUTH-004a : ne jamais bloquer l'inscription en attendant la validation).
    if (registrationGated && dto.parentPhone) {
      await this.parentalConsent.requestConsent(user.id, dto.parentPhone);
    }

    return {
      userId: user.id,
      isMinor,
      message: isMinor
        ? 'Code de vérification envoyé par SMS. Un SMS de consentement a également été envoyé au parent/tuteur déclaré.'
        : 'Code de vérification envoyé par SMS.',
      // Statut brut, traduit par le client. `null` quand aucun code n'a été saisi —
      // à ne pas confondre avec un code saisi puis rejeté, qui vaut
      // CODE_NOT_RECOGNIZED et doit être annoncé à l'utilisateur.
      ambassadorAttribution: ambassadorAttribution?.status ?? null,
    };
  }

  // ==========================================================================
  // RENVOYER LE CODE D'INSCRIPTION
  //
  // DÉFAUT CORRIGÉ LE 2026-08-10, trouvé en recette réelle. Le code expire en
  // cinq minutes, et AUCUNE route ne permettait d'en obtenir un autre. La suite
  // se refermait sur elle-même :
  //
  //   code expiré → pas de renvoi → la connexion exige un compte vérifié
  //               → relancer le tuteur exige d'être connecté
  //               → COMPTE DÉFINITIVEMENT PERDU
  //
  // Et le numéro, unique en base, devenait inutilisable : le jeune aurait dû
  // changer de téléphone pour accéder à la plateforme. Cinq minutes est un
  // délai pensé pour un réseau européen ; sur les réseaux visés, un SMS met
  // couramment plus longtemps.
  //
  // CETTE ROUTE NE DIT JAMAIS SI LE COMPTE EXISTE. Elle est publique et prend
  // un numéro de téléphone : distinguer « compte inconnu » de « code renvoyé »
  // en ferait un annuaire des inscrits de la plateforme — c'est-à-dire, ici,
  // un annuaire de mineurs. La réponse est donc invariablement la même.
  // ==========================================================================
  async resendRegistrationOtp(phone: string) {
    const reponseInvariable = {
      message:
        'Si un compte est en attente de vérification pour ce numéro, un nouveau code vient d’être envoyé.',
    };

    const user = await this.prisma.user.findUnique({ where: { phone } });

    // Compte inconnu, déjà vérifié, ou supprimé : rien à faire, et surtout rien
    // à dire. On sort par la même porte que le cas nominal.
    if (
      !user ||
      user.phoneVerifiedAt ||
      !user.phone ||
      user.status === AccountStatus.DELETED ||
      user.status === AccountStatus.PENDING_DELETION
    ) {
      return reponseInvariable;
    }

    // Le délai de garde. Contrôlé APRÈS avoir établi que le compte existe, mais
    // sans que la réponse le trahisse : une attente trop courte rend la même
    // phrase, simplement sans envoyer de SMS.
    const cooldown = Number(
      this.config.get<string>('OTP_RESEND_COOLDOWN_SECONDS', '60'),
    );
    const ecoule = await this.otp.secondesDepuisDernierEnvoi(
      user.id,
      OtpPurpose.REGISTRATION,
    );
    if (ecoule !== null && ecoule < cooldown) {
      await this.audit.record('REGISTRATION_OTP_RESEND_THROTTLED', user.id, {
        secondesEcoulees: Math.round(ecoule),
        cooldown,
      });
      return reponseInvariable;
    }

    // `generateAndSend` consomme les codes précédents avant d'en créer un.
    await this.otp.generateAndSend(
      user.id,
      user.phone,
      OtpPurpose.REGISTRATION,
    );
    await this.audit.record('REGISTRATION_OTP_RESENT', user.id, {});

    return reponseInvariable;
  }

  async verifyRegistrationOtp(
    dto: VerifyOtpDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user) throw new NotFoundException('Compte introuvable.');

    // La preuve, pas le statut. Un compte dont le statut a bougé pour une autre
    // raison — un refus parental, par exemple — n'est pas un compte vérifié.
    if (user.phoneVerifiedAt) {
      throw new BadRequestException('Ce compte est déjà vérifié.');
    }

    const isValid = await this.otp.verify(
      user.id,
      dto.code,
      OtpPurpose.REGISTRATION,
    );
    if (!isValid) throw new UnauthorizedException('Code invalide ou expiré.');

    const lsId = await this.generateUniqueLsId();
    const registrationGated =
      user.dateOfBirth && user.countryOfResidence
        ? await this.minorPolicy.isActionGated(
            user,
            MinorGatedAction.REGISTRATION,
          )
        : false;
    const newStatus = registrationGated
      ? AccountStatus.AWAITING_PARENTAL_CONSENT
      : AccountStatus.ACTIVE;

    // ========================================================================
    // LE SEUL ENDROIT DU CODE QUI ÉCRIT `phoneVerifiedAt`
    //
    // Un test de confinement l'impose. La preuve de possession du téléphone
    // naît ici, à l'instant où un code reçu par SMS a été présenté — et nulle
    // part ailleurs. Elle ne repasse jamais à NULL : une preuve effaçable n'est
    // pas une preuve.
    // ========================================================================
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lsId, status: newStatus, phoneVerifiedAt: new Date() },
    });

    await this.audit.record('ACCOUNT_PHONE_VERIFIED', user.id, {
      lsId,
      newStatus,
    });

    // Premier appareil du compte — jamais de notification "nouvel appareil" ici, le
    // parcours d'inscription vient déjà de faire ses preuves via l'OTP.
    const { accessToken, refreshToken } =
      await this.createSessionAndIssueTokens(user.id, userAgent, ip);

    return {
      lsId,
      status: newStatus,
      accessToken,
      refreshToken,
      requiresParentalLink: registrationGated,
    };
  }

  private async generateUniqueLsId(): Promise<string> {
    const countryCode = this.config.get<string>('LS_ID_COUNTRY_CODE', 'CM');
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateLsIdCandidate(countryCode);
      const exists = await this.prisma.user.findUnique({
        where: { lsId: candidate },
      });
      if (!exists) return candidate;
    }
    throw new InternalServerErrorException(
      'Impossible de générer un LS-ID unique, réessayez.',
    );
  }

  // --- FR-AUTH login / session ------------------------------------------------------------

  async login(
    dto: LoginDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    // ========================================================================
    // LE BUDGET SE CONSOMME AVANT DE SAVOIR SI LE COMPTE EXISTE — S-06-C
    //
    // Le compteur d'échecs vivait sur la ligne `User` de la victime. Cinq
    // requêtes d'un inconnu l'excluaient quinze minutes de son propre compte,
    // vingt requêtes par heure l'en excluaient indéfiniment, et le journal
    // imputait le verrouillage à la victime elle-même. Mesuré le 2026-08-12.
    //
    // Le compteur appartient désormais à L'ORIGINE de la tentative. Un tiers
    // ne peut plus rien écrire dans l'état du compte d'autrui.
    //
    // POURQUOI ICI, AVANT `findFirst`. Consommer le budget après aurait rendu
    // le limiteur bavard : le temps de réponse aurait différé selon que le
    // compte existe ou non, et l'on aurait rouvert par la fenêtre l'oracle que
    // la passe 1 vient de fermer par la porte. L'identifiant est compté TEL
    // QU'IL A ÉTÉ REÇU, réel ou inventé.
    // ========================================================================
    const limite = await this.throttle.consommer(ip, dto.identifier);
    if (!limite.autorise) {
      // Ce message décrit l'APPELANT, jamais le compte : il est rigoureusement
      // le même pour un numéro réel et pour un numéro qui n'existe pas.
      throw new HttpException(
        'Trop de tentatives de connexion. Réessayez plus tard.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ phone: dto.identifier }, { email: dto.identifier }] },
    });

    // ========================================================================
    // LE MOT DE PASSE D'ABORD, LES DÉCISIONS SUR LE COMPTE ENSUITE — S-06
    //
    // L'INTENTION ÉTAIT LÀ DEPUIS LE DÉBUT : « réponse volontairement identique
    // que le compte existe ou non ». Le message l'était. L'ORDRE ne l'était pas.
    //
    // S-06-A. Le verrouillage et le statut étaient examinés AVANT le mot de
    // passe. Un compte désactivé répondait donc 403 dès la première tentative,
    // à qui ne connaissait rien de lui ; et cinq tentatives sur un numéro réel
    // finissaient par produire un 403 de verrouillage là où un numéro inventé
    // restait indéfiniment en 401. Deux façons de demander « ce compte
    // existe-t-il ? » et d'obtenir une réponse.
    //
    // S-06-B. Plus grave, parce que muet : Argon2 n'était atteint que si le
    // compte existait. Mesuré le 2026-08-12, 30 essais par scénario — 2,26 ms
    // de médiane pour un inconnu, 71,46 ms pour un compte réel, sans le moindre
    // recouvrement des plages. UNE requête, aucune trace, aucune modification
    // d'état : l'oracle le plus commode qui soit.
    //
    // CE QUI CHANGE. On vérifie toujours un mot de passe — contre le condensat
    // réel si le compte existe, contre un condensat factice sinon. Le travail
    // cryptographique est le même des deux côtés, donc le temps aussi. Puis,
    // et seulement pour qui a PROUVÉ qu'il connaît le mot de passe, on parle de
    // l'état du compte.
    //
    // CE QUI NE CHANGE PAS. Le titulaire légitime reste informé : verrouillage,
    // désactivation, vérification OTP manquante — tout lui est dit, après la
    // preuve. Ce n'est pas une information retirée, c'est une information
    // conditionnée.
    //
    // CE QUE LA PASSE 2 A REFERMÉ. Le compteur d'échecs ne vit plus sur le
    // compte visé : il est porté par `LoginThrottle`, clé sur l'ORIGINE de la
    // tentative (S-06-C). Un tiers ne peut donc plus exclure quelqu'un de son
    // compte. Et comme plus rien ne s'écrit sur la ligne de la victime, l'écart
    // de temps résiduel entre les deux chemins disparaît avec l'écriture qui le
    // causait : le seul travail restant est la vérification Argon2, identique
    // des deux côtés. Mesuré le 2026-08-14, trois séries de 20 essais :
    // rapport 0,993 / 1,010 / 0,993 — contre ×1,38–1,40 à l'issue de la passe 1,
    // et ×31,65 avant toute correction.
    // ========================================================================
    const condensat = user ? user.password : await condensatFactice();
    const motDePasseValide = await argon2.verify(condensat, dto.password);

    if (!user || !motDePasseValide) {
      // UNE ÉCRITURE, DES DEUX CÔTÉS. Le journal note l'échec que le compte
      // existe ou non — `userId` nul quand l'identifiant est inconnu. Écrire
      // seulement pour les comptes réels rendrait le chemin « compte existant »
      // mesurablement plus lent : c'est précisément le résidu de ×1,4 que la
      // passe 1 avait laissé, et qui disparaît ici.
      //
      // L'identifiant tenté n'est PAS consigné : le journal d'audit deviendrait
      // sinon une liste de numéros de téléphone. L'origine suffit à repérer un
      // balayage, et c'est elle qui manquait — un verrouillage n'identifiait
      // jusqu'ici que sa victime.
      await this.audit.record(
        'LOGIN_FAILED',
        user?.id ?? null,
        { degrade: limite.degrade },
        { ipAddress: ip, userAgent },
      );
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // --- À partir d'ici, l'appelant a prouvé qu'il connaît le mot de passe ---

    // ========================================================================
    // LE REMBOURSEMENT, ET POURQUOI IL EST ICI PLUTÔT QUE PLUS BAS
    //
    // La réservation posée par `consommer()` est rendue à L'INSTANT PRÉCIS où
    // le mot de passe est prouvé — avant le verrou, avant le statut, avant
    // l'OTP. Trois raisons, dans cet ordre d'importance :
    //
    //   L'ÉQUITÉ ENVERS LES VOISINS DE NAT. Le compteur par origine est partagé
    //     par tous les abonnés d'une même adresse. Quelqu'un qui vient de
    //     prouver son mot de passe n'est pas un attaquant, même si son compte
    //     lui est ensuite refusé pour une raison parfaitement légitime. Le
    //     laisser peser sur le budget commun ferait payer son voisin.
    //
    //   CE N'EST PAS UNE DÉCISION DE SÉCURITÉ. Rien ici n'autorise ni ne
    //     refuse : les trois contrôles qui suivent sont inchangés et gardent
    //     le dernier mot. Déplacer cet appel plus bas dégraderait l'équité,
    //     jamais la sécurité — ce qui suffit à ne pas le faire.
    //
    //   AUCUNE FUITE. Ce chemin n'est atteint que si le mot de passe est
    //     correct, ce qu'un identifiant inexistant ne peut jamais obtenir : il
    //     est vérifié contre le condensat factice. Le remboursement n'apprend
    //     donc rien sur l'existence d'un compte, et il coûte une commande
    //     Redis face aux ~74 ms d'Argon2 — inobservable au chronomètre.
    // ========================================================================
    await this.throttle.preuveDuMotDePasse(ip, dto.identifier);

    // ========================================================================
    // `lockedUntil` EST LU, N'EST PLUS ÉCRIT — et cette lecture est temporaire
    //
    // POURQUOI LA GARDER. Le déploiement trouvera en base des comptes portant
    // un verrou posé par l'ancien mécanisme. Supprimer la lecture le même jour
    // les rendrait connectables d'un coup, alors qu'ils avaient été verrouillés
    // pour une raison — fût-elle mauvaise. On laisse donc les verrous existants
    // expirer d'eux-mêmes : plus rien ne les écrit ni ne les repousse, ils
    // meurent au bout de leur quart d'heure et cette branche devient inerte.
    // Le retrait de la lecture et des colonnes fait l'objet d'un chantier
    // distinct, une fois cette extinction constatée en base.
    //
    // POURQUOI ELLE N'OUVRE AUCUN CONTOURNEMENT DU NOUVEAU LIMITEUR.
    //   Elle est en AVAL de `consommer()` : la décision du limiteur est déjà
    //     prise et appliquée quand on arrive ici. Un compte verrouillé ne
    //     saute aucun budget.
    //   Elle ne peut que REFUSER, jamais autoriser : `lockedUntil` ne produit
    //     qu'un 403 et n'a aucun chemin vers une session.
    //   Elle est en AVAL de la preuve du mot de passe : elle ne dit donc rien
    //     à qui ne le connaît pas, et ne rouvre pas S-06-A.
    //   Elle est INACCESSIBLE À UN TIERS : plus aucun code n'écrit cette
    //     colonne, un attaquant ne peut donc plus la faire poser sur autrui.
    //     C'est précisément ce que S-06-C a refermé.
    // ========================================================================
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        'Compte temporairement bloqué suite à plusieurs tentatives infructueuses. Réessayez plus tard.',
      );
    }

    const blockedStatuses: AccountStatus[] = [
      AccountStatus.DEACTIVATED,
      AccountStatus.PENDING_DELETION,
      AccountStatus.DELETED,
    ];
    if (blockedStatuses.includes(user.status)) {
      throw new ForbiddenException('Ce compte est désactivé.');
    }

    // ========================================================================
    // LA CONNEXION LIT UN FAIT, PLUS UN STATUT
    //
    // Défaut corrigé le 2026-08-10, trouvé en recette réelle. Cette ligne
    // testait `status === PENDING_VERIFICATION`. Or neuf endroits écrivent ce
    // statut, dont six sans rapport avec la vérification — et `declineConsent`
    // l'écrivait SANS CONDITION.
    //
    // Un compte jamais vérifié sortait donc de PENDING_VERIFICATION dès qu'un
    // tuteur refusait, et devenait connectable. Observé en base : un
    // LOGIN_SUCCESS sans le moindre ACCOUNT_PHONE_VERIFIED, sans LS-ID.
    //
    // Le contournement que cela ouvrait : s'inscrire avec le numéro d'autrui,
    // se déclarer soi-même comme tuteur, refuser depuis son propre téléphone.
    // Le numéro de la victime, unique en base, devenait inutilisable pour elle.
    // ========================================================================
    if (!user.phoneVerifiedAt) {
      throw new ForbiddenException(
        "Ce compte n'a pas encore été vérifié par OTP.",
      );
    }

    // L'ANCIEN VERROU N'EST PLUS NI ÉCRIT NI REMIS À ZÉRO — S-06-C. Les
    // colonnes `failedLoginAttempts` et `lockedUntil` restent en base, sans
    // migration : un verrou posé avant ce déploiement continue d'être LU
    // au-dessus, et expire de lui-même au bout de son quart d'heure. Après
    // quoi il devient inerte.
    await this.audit.record('LOGIN_SUCCESS', user.id, undefined, {
      ipAddress: ip,
      userAgent,
    });

    // CLAUDE.md §2 : double authentification — le mot de passe seul ne suffit pas à
    // ouvrir la session tant que le second facteur n'est pas vérifié. Aucun jeton
    // d'accès/rafraîchissement n'est émis à ce stade.
    //
    // `limite.secondFacteurRequis` s'y ajoute : quand le compteur global par
    // identifiant est dépassé — signe d'un bourrage distribué — on exige le
    // téléphone même d'un compte qui n'avait pas activé la double
    // authentification. CE DRAPEAU N'EST LU QU'ICI, après la preuve du mot de
    // passe : un attaquant qui l'ignore ne peut donc provoquer AUCUN envoi de
    // SMS, si nombreuses que soient ses tentatives.
    if (user.twoFactorEnabled || limite.secondFacteurRequis) {
      if (!user.phone) {
        throw new InternalServerErrorException(
          'Double authentification activée sans numéro de téléphone associé.',
        );
      }
      // ======================================================================
      // UN SMS PAR FENÊTRE, PAS UN PAR REQUÊTE — A1
      //
      // LE DÉFAUT, TROUVÉ EN AUDIT DE CETTE PASSE. Le palier de vigilance par
      // origine exige le second facteur pour TOUTE connexion venant d'une
      // adresse où les échecs s'accumulent. Un attaquant n'a donc qu'à
      // maintenir ce palier franchi — 3,4 requêtes ratées par minute suffisent
      // — pour qu'un SMS parte à CHAQUE connexion légitime derrière ce NAT.
      // Sans borne. Le limiteur, censé protéger les abonnés, devenait un
      // générateur de SMS facturés à leurs dépens.
      //
      // LE MÊME DÉLAI DE GARDE QUE LE RENVOI MANUEL, volontairement : deux
      // mécanismes de temporisation finiraient par diverger, et l'un des deux
      // serait oublié le jour où l'on modifie l'autre.
      //
      // ON NE REFUSE PAS LA CONNEXION, ON N'ENVOIE PAS DE SECOND MESSAGE. Le
      // défi est émis dans tous les cas : le code précédent est encore vivant
      // — le délai de garde est plus court que la durée de vie d'un code — et
      // c'est LUI que l'utilisateur saisit. Refuser la connexion aurait offert
      // à l'attaquant, en échange de son SMS, un déni de service.
      //
      // AUCUNE FUITE. La réponse est rigoureusement la même, SMS envoyé ou
      // non : mêmes champs, même jeton de défi. Et l'on n'arrive ici qu'après
      // la preuve du mot de passe, donc jamais pour un identifiant inconnu.
      // ======================================================================
      const cooldown = Number(
        this.config.get<string>('OTP_RESEND_COOLDOWN_SECONDS', '60'),
      );
      const ecoule = await this.otp.secondesDepuisDernierEnvoi(
        user.id,
        OtpPurpose.LOGIN_2FA,
      );
      if (ecoule !== null && ecoule < cooldown) {
        await this.audit.record('LOGIN_2FA_SMS_THROTTLED', user.id, {
          secondesEcoulees: Math.round(ecoule),
          cooldown,
        });
      } else {
        await this.otp.generateAndSend(
          user.id,
          user.phone,
          OtpPurpose.LOGIN_2FA,
        );
      }

      const challengeToken = await this.tokens.signTwoFactorChallenge(user.id);
      await this.audit.record('LOGIN_2FA_CHALLENGE_SENT', user.id);
      return { requiresTwoFactor: true as const, challengeToken };
    }

    return {
      requiresTwoFactor: false as const,
      ...(await this.createSessionAndIssueTokens(user.id, userAgent, ip)),
    };
  }

  // --- Double authentification par SMS (CLAUDE.md §2) --------------------------------------

  async verifyLoginTwoFactor(
    dto: VerifyLoginTwoFactorDto,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    let userId: string;
    try {
      userId = this.tokens.verifyTwoFactorChallenge(dto.challengeToken);
    } catch {
      throw new UnauthorizedException(
        'Jeton de vérification invalide ou expiré.',
      );
    }

    const isValid = await this.otp.verify(
      userId,
      dto.code,
      OtpPurpose.LOGIN_2FA,
    );
    if (!isValid) throw new UnauthorizedException('Code invalide ou expiré.');

    await this.audit.record('LOGIN_2FA_VERIFIED', userId);
    return this.createSessionAndIssueTokens(userId, userAgent, ip);
  }

  // Contact d'urgence facultatif — pertinent en pratique pour un compte majeur (un
  // mineur a déjà un parent/tuteur rattaché via ParentalLink, cf. cahier des charges).
  async updateEmergencyContact(userId: string, dto: UpdateEmergencyContactDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        emergencyContactName: dto.name,
        emergencyContactPhone: dto.phone,
      },
      select: { emergencyContactName: true, emergencyContactPhone: true },
    });
    await this.audit.record('EMERGENCY_CONTACT_UPDATED', userId);
    return updated;
  }

  async getTwoFactorStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    return { enabled: user.twoFactorEnabled };
  }

  async enableTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!user.phone) {
      throw new BadRequestException(
        'Un numéro de téléphone est requis pour activer la double authentification.',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    await this.audit.record('TWO_FACTOR_ENABLED', userId);
    return { message: 'Double authentification activée.' };
  }

  async disableTwoFactor(userId: string, dto: DisableTwoFactorDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const passwordOk = await argon2.verify(user.password, dto.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Mot de passe incorrect.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    });
    await this.audit.record('TWO_FACTOR_DISABLED', userId);
    return { message: 'Double authentification désactivée.' };
  }

  // --- Appareils connectés (CLAUDE.md §2) ---------------------------------------------------

  async listSessions(userId: string) {
    return this.tokens.listSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string) {
    const revoked = await this.tokens.revokeSession(userId, sessionId);
    if (!revoked) {
      throw new NotFoundException('Session introuvable pour ce compte.');
    }
    await this.audit.record('SESSION_REVOKED', userId, { sessionId });
    return { message: 'Appareil déconnecté.' };
  }

  private async createSessionAndIssueTokens(
    userId: string,
    userAgent: string | undefined,
    ip: string | undefined,
  ) {
    const deviceLabel = deriveDeviceLabel(userAgent);

    const hasAnySession = await this.prisma.session.findFirst({
      where: { userId },
    });
    const isNewDevice =
      !!hasAnySession &&
      !(await this.tokens.hasSeenDevice(userId, deviceLabel));

    const session = await this.tokens.createSession(
      userId,
      deviceLabel,
      userAgent,
      ip,
    );

    if (isNewDevice) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.phone) {
        await this.sms.send(
          user.phone,
          `LES STAGIAIRES — nouvelle connexion depuis un appareil non reconnu (${deviceLabel}). Si ce n'est pas vous, changez votre mot de passe et révoquez cet appareil dans vos paramètres.`,
        );
      }
      await this.audit.record('NEW_DEVICE_LOGIN', userId, { deviceLabel });
    }

    return this.issueTokens(userId, session.id);
  }

  // ==========================================================================
  // `registerFailedAttempt()` A ÉTÉ SUPPRIMÉE — S-06-C, le 2026-08-12.
  //
  // Elle incrémentait `failedLoginAttempts` sur la ligne `User` de la CIBLE,
  // puis posait `lockedUntil` au bout de cinq échecs. C'était le vecteur : un
  // tiers ne connaissant qu'un numéro excluait son titulaire quinze minutes,
  // indéfiniment renouvelables pour vingt requêtes par heure.
  //
  // Le comptage vit désormais dans `login-throttle/`, attaché à l'origine de
  // la tentative. Les deux colonnes RESTENT en base, sans migration : un verrou
  // antérieur au déploiement est encore lu, et expire de lui-même.
  // ==========================================================================

  private async issueTokens(userId: string, sessionId: string) {
    const roles = await this.getActiveRoleNames(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { countryOfResidence: true },
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      roles,
      sessionId,
      countryCode: user?.countryOfResidence ?? undefined,
    });
    const refreshToken = await this.tokens.issueRefreshToken(userId, sessionId);
    return { accessToken, refreshToken };
  }

  private async getActiveRoleNames(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, isActive: true },
      include: { role: true },
    });
    return userRoles.map((userRole) => userRole.role.name);
  }

  async refresh(dto: RefreshTokenDto) {
    const rotated = await this.tokens.rotateRefreshToken(dto.refreshToken);
    if (!rotated)
      throw new UnauthorizedException('Refresh token invalide ou expiré.');

    const roles = await this.getActiveRoleNames(rotated.userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: rotated.userId },
      select: { countryOfResidence: true },
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: rotated.userId,
      roles,
      sessionId: rotated.sessionId ?? undefined,
      countryCode: user.countryOfResidence ?? undefined,
    });
    return { accessToken, refreshToken: rotated.newToken };
  }

  async logout(dto: RefreshTokenDto) {
    await this.tokens.revokeRefreshToken(dto.refreshToken);
    return { message: 'Déconnecté.' };
  }

  // --- FR-AUTH-006 : récupération de mot de passe -----------------------------------------

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    // Message identique que le compte existe ou non, pour ne pas révéler son existence
    if (user) {
      await this.otp.generateAndSend(
        user.id,
        dto.phone,
        OtpPurpose.PASSWORD_RESET,
      );
      await this.audit.record('PASSWORD_RESET_REQUESTED', user.id);
    }
    return {
      message:
        'Si ce numéro est associé à un compte, un code de réinitialisation a été envoyé par SMS.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user) throw new UnauthorizedException('Code invalide ou expiré.');

    const isValid = await this.otp.verify(
      user.id,
      dto.code,
      OtpPurpose.PASSWORD_RESET,
    );
    if (!isValid) throw new UnauthorizedException('Code invalide ou expiré.');

    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllRefreshTokensForUser(user.id);
    await this.audit.record('PASSWORD_RESET_COMPLETED', user.id);

    return {
      message:
        'Mot de passe réinitialisé. Toutes les sessions actives ont été déconnectées.',
    };
  }

  // --- FR-AUTH-005 / 007 : rôles multiples et historique ----------------------------------

  // Catalogue public des rôles auto-attribuables — seul moyen pour un client de
  // connaître les roleId à passer à assignRole()/switchActiveRole(), sans jamais
  // exposer les rôles non auto-attribuables (ex. ADMIN) ni leurs identifiants
  // (CLAUDE.md §3 : moindre privilège, même pour de simples identifiants techniques).
  // --- V6-1 : PARCOURS PROFESSIONNEL ----------------------------------------
  //
  // Ces deux méthodes ne prennent QUE l'identifiant du titulaire, issu du jeton.
  // Aucune ne reçoit d'identifiant cible : il est donc structurellement
  // impossible, depuis l'API, de lire ou d'écrire le parcours de quelqu'un
  // d'autre — un recruteur, un établissement, un ambassadeur ou un tuteur ne
  // dispose d'aucun chemin, pas même mal contrôlé.
  async getMyPath(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      // Sélection close, jamais l'entité entière : ajouter une colonne à `User`
      // ne doit pas la faire apparaître ici par accident.
      select: { initialIntent: true, currentPath: true },
    });
    return {
      initialIntent: user.initialIntent,
      currentPath: user.currentPath,
    };
  }

  // Le parcours est déclaratif et n'obéit à AUCUNE machine à états : toutes les
  // transitions entre les trois valeurs sont permises, retours en arrière
  // compris. Une reprise d'études après un emploi est ordinaire, et un ordre
  // imposé transformerait une situation vécue en parcours administratif.
  //
  // Il n'est jamais écrit automatiquement — ni depuis une candidature, un
  // diplôme, une expérience, un abonnement, un rôle ou un paiement. Déduire une
  // situation d'un comportement, c'est répéter la faute de PENDING_VERIFICATION.
  async setMyPath(userId: string, path: UserPath) {
    const avant = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { initialIntent: true, currentPath: true },
    });

    // Une déclaration identique n'est pas une transition : la journaliser
    // remplirait le grand livre d'événements qui n'apprennent rien.
    if (avant.currentPath === path) {
      return {
        initialIntent: avant.initialIntent,
        currentPath: avant.currentPath,
        changed: false,
      };
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { currentPath: path },
      select: { initialIntent: true, currentPath: true },
    });

    await this.audit.record('USER_PATH_CHANGED', userId, {
      from: avant.currentPath,
      to: path,
    });

    return {
      initialIntent: user.initialIntent,
      currentPath: user.currentPath,
      changed: true,
    };
  }

  async listSelfAssignableRoles() {
    return this.prisma.role.findMany({
      where: { selfAssignable: true },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  async assignRole(userId: string, roleId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Rôle introuvable.');
    if (!role.selfAssignable) {
      throw new ForbiddenException('Ce rôle ne peut pas être auto-attribué.');
    }

    const existing = await this.prisma.userRole.findFirst({
      where: { userId, roleId },
    });

    if (existing?.isActive) {
      throw new ConflictException('Ce rôle est déjà actif sur ce compte.');
    }

    const userRole = existing
      ? await this.prisma.userRole.update({
          where: { id: existing.id },
          data: { isActive: true, assignedAt: new Date(), revokedAt: null },
        })
      : await this.prisma.userRole.create({ data: { userId, roleId } });

    await this.audit.record(
      existing ? 'ROLE_REACTIVATED' : 'ROLE_ASSIGNED',
      userId,
      { roleId },
    );
    return userRole;
  }

  async revokeRole(userId: string, userRoleId: string) {
    const userRole = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
    });
    if (!userRole || userRole.userId !== userId) {
      throw new NotFoundException('Rôle introuvable pour ce compte.');
    }
    if (!userRole.isActive) {
      throw new BadRequestException('Ce rôle est déjà inactif.');
    }

    const updated = await this.prisma.userRole.update({
      where: { id: userRole.id },
      data: { isActive: false, revokedAt: new Date() },
    });

    await this.audit.record('ROLE_REVOKED', userId, {
      roleId: userRole.roleId,
    });
    return updated;
  }

  async getRoleHistory(userId: string) {
    return this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  // --- FR-AUTH-009 / 010 : export et suppression du compte --------------------------------

  async exportUserData(userId: string) {
    // consentCodeHash n'est jamais inclus, même dans l'export du titulaire du compte —
    // c'est un secret de vérification, pas une donnée personnelle (CLAUDE.md §6).
    const parentalLinkSelect = {
      id: true,
      childId: true,
      parentPhone: true,
      parentId: true,
      status: true,
      flaggedAt: true,
      createdAt: true,
      confirmedAt: true,
    } as const;

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        parentLinksAsChild: { select: parentalLinkSelect },
        parentLinksAsParent: { select: parentalLinkSelect },
      },
    });

    // Le hash du mot de passe ne fait jamais partie d'un export, même vers son propre titulaire
    const { password: _password, ...exportableData } = user;
    void _password;

    await this.audit.record('DATA_EXPORT_REQUESTED', userId);
    return exportableData;
  }

  async deactivateAccount(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: AccountStatus.DEACTIVATED, deactivatedAt: new Date() },
    });
    await this.tokens.revokeAllRefreshTokensForUser(userId);
    await this.audit.record('ACCOUNT_DEACTIVATED', userId);

    return {
      message:
        'Compte désactivé. Contactez le support pour le réactiver avant la suppression définitive.',
    };
  }

  async requestDeletion(userId: string) {
    const deletionScheduledAt = new Date(
      Date.now() + RETENTION_DAYS_BEFORE_HARD_DELETE * 24 * 60 * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: AccountStatus.PENDING_DELETION,
        deactivatedAt: new Date(),
        deletionScheduledAt,
      },
    });
    await this.tokens.revokeAllRefreshTokensForUser(userId);
    await this.audit.record('ACCOUNT_DELETION_REQUESTED', userId, {
      deletionScheduledAt,
    });

    return {
      message: `Suppression programmée pour le ${deletionScheduledAt.toISOString()}. Contactez le support avant cette date pour annuler.`,
      deletionScheduledAt,
    };
  }
}
