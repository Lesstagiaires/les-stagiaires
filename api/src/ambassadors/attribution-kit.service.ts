import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { AmbassadorStatus } from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================================
// KIT D'AFFILIATION — CODE, LIEN, QR
//
// Arbitrage 10 du promoteur, 2026-08-02 :
//
//   « Le code, le lien personnel et le QR Code ne doivent devenir utilisables
//     qu'au statut ACTIVE. Le QR Code ne doit pas être stocké comme fichier
//     permanent. Il doit être généré à partir du lien de parrainage lorsque
//     l'utilisateur l'affiche ou le télécharge. »
//
// LE QR N'EST PAS STOCKÉ, ET CE N'EST PAS UNE ÉCONOMIE DE PLACE. Un fichier
// stocké survit à ce qu'il représente : il reste consultable, partageable et
// indexable après une suspension ou une résiliation, et rien ne garantit qu'on
// pense à le supprimer. Un QR calculé à l'affichage ne peut pas survivre au
// droit qui le fonde — s'il n'y a plus de code actif, il n'y a plus de QR.
//
// C'est aussi pourquoi ce service ne met RIEN en cache : un cache est un stockage
// qui ne dit pas son nom.
// ============================================================================
@Injectable()
export class AttributionKitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // Le kit complet de l'ambassadeur. N'existe QUE pour un dossier ACTIVE.
  async myKit(userId: string) {
    const ambassador = await this.prisma.ambassador.findUnique({
      where: { userId },
      select: { id: true, code: true, status: true },
    });
    if (!ambassador) {
      throw new NotFoundException("Vous n'êtes pas ambassadeur.");
    }

    // LE VERROU. Un dossier suspendu garde son code en base — c'est voulu, pour
    // qu'une réintégration ne casse pas les liens déjà distribués — mais il ne
    // le REÇOIT plus. Servir le kit d'un suspendu reviendrait à lui laisser
    // recruter pendant sa suspension.
    if (ambassador.status !== AmbassadorStatus.ACTIVE || !ambassador.code) {
      throw new ConflictException(
        'Votre kit d’affiliation sera disponible dès l’activation de votre dossier.',
      );
    }

    const link = this.buildLink(ambassador.code);

    return {
      code: ambassador.code,
      link,
      // GÉNÉRÉ MAINTENANT, à partir du lien. Rien n'est écrit nulle part.
      qrDataUrl: await QRCode.toDataURL(link, { errorCorrectionLevel: 'M' }),
    };
  }

  // Le lien personnel de parrainage. Court, lisible, et surtout : il ne contient
  // que le code — aucun identifiant interne, aucun nom. Un lien se colle dans un
  // groupe WhatsApp ; ce qu'il porte devient public.
  buildLink(code: string): string {
    const baseUrl = this.config.get<string>(
      'APP_PUBLIC_URL',
      'http://localhost:3000',
    );
    return `${baseUrl}/r/${code}`;
  }

  // ==========================================================================
  // LA ROUTE PUBLIQUE `/r/:code`
  //
  // Règle de sécurité arrêtée par le promoteur (arbitrage 10) :
  //
  //   « La route publique doit présenter un comportement extérieur IDENTIQUE,
  //     que le code soit valide ou non ; aucune réponse ne doit permettre
  //     d'énumérer les codes actifs ; la validité réelle du code n'est
  //     communiquée qu'au moment approprié dans le parcours d'inscription ;
  //     un code invalide ne bloque JAMAIS l'inscription. »
  //
  // D'où une réponse RIGOUREUSEMENT CONSTANTE : même forme, mêmes champs, même
  // statut HTTP. Un code inconnu, un code de dossier suspendu et un code
  // parfaitement valide produisent le même objet. Rien — ni un booléen, ni un
  // message, ni un code HTTP différent — ne permet de distinguer les trois.
  //
  // Le code est simplement RENVOYÉ AU PARCOURS D'INSCRIPTION, qui le transmettra
  // à `attributeUser()` le moment venu. C'est là, et là seulement, que sa
  // validité est établie — après que la personne a créé son compte, donc sans
  // qu'un échec puisse lui coûter son inscription.
  // ==========================================================================
  async resolvePublicLink(rawCode: string) {
    // AUCUNE lecture en base ici. Ce n'est pas un oubli : interroger la base
    // ouvrirait la porte à une attaque temporelle — un code existant se
    // résoudrait mesurablement plus vite qu'un code inconnu, et cet écart suffit
    // à énumérer. Ne rien chercher, c'est ne rien pouvoir trahir.
    //
    // La journalisation, elle, a lieu : ces appels alimenteront les signaux
    // antifraude (un balayage de codes se voit dans le volume).
    await this.audit.record('AMBASSADOR_LINK_VISITED', null, {
      // Le code tel que reçu, tronqué : assez pour repérer un balayage, pas
      // assez pour reconstituer une liste depuis le journal.
      codePrefix: rawCode.slice(0, 3),
      length: rawCode.length,
    });

    return {
      // Toujours la même forme. Le parcours d'inscription préremplira le champ ;
      // si le code ne vaut rien, l'inscription se fera quand même, sans parrain.
      attributionCode: rawCode,
      // Où poursuivre. Constant lui aussi.
      next: 'REGISTER' as const,
    };
  }
}
