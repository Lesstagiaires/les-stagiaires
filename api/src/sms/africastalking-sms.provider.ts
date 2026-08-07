import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from './sms-provider.interface';

// ============================================================================
// ENVOI DE SMS VIA AFRICA'S TALKING
//
// Ce fournisseur porte les codes à usage unique et les demandes de consentement
// parental. Un SMS qui n'arrive pas, c'est un utilisateur qui ne peut pas
// s'inscrire — et, pour un mineur, un parent qui n'est jamais sollicité
// (CLAUDE.md §5). Toute la prudence de ce fichier vient de là.
//
// ---------------------------------------------------------------------------
// UN CODE HTTP 201 NE VEUT PAS DIRE « ENVOYÉ »
//
// C'est le piège central de cette API, et la raison principale de cette
// réécriture. Africa's Talking répond 201 Created dès que la requête est
// acceptée, puis place le VRAI verdict à l'intérieur du corps, destinataire par
// destinataire :
//
//   { "SMSMessageData": { "Recipients": [ { "statusCode": 406, ... } ] } }
//
// Un numéro invalide, un solde insuffisant, un destinataire en liste noire :
// tout cela rend 201. S'arrêter à `response.ok` fait croire à un envoi réussi
// alors que rien n'est parti. Le code d'inscription poursuit, l'utilisateur
// attend un SMS qui n'existe pas, et aucune trace n'indique pourquoi.
//
// On lit donc le statut de CHAQUE destinataire, et on échoue s'il n'est pas
// dans les trois codes de succès.
//
// ---------------------------------------------------------------------------
// CE QUI NE DOIT JAMAIS ENTRER DANS UN JOURNAL
//
// Le message lui-même contient le code OTP. Il n'est écrit nulle part, jamais,
// même en cas d'erreur (CLAUDE.md §2 : aucun code de vérification en clair dans
// un log). Le numéro du destinataire est une donnée personnelle : il n'apparaît
// que masqué, comme dans le fournisseur console.
//
// La réponse d'erreur de l'API peut, elle aussi, contenir le numéro. Elle est
// donc assainie avant d'être journalisée, jamais recopiée telle quelle.
//
// ---------------------------------------------------------------------------
// AUCUNE NOUVELLE TENTATIVE AUTOMATIQUE — C'EST UN CHOIX
//
// L'API n'est pas idempotente : aucune clef ne permet de dire « c'est le même
// envoi ». Après un délai d'attente dépassé, on ne sait PAS si le SMS est parti.
// Réessayer, c'est risquer un double envoi facturé, et deux codes OTP différents
// arrivant dans le désordre — le second invalidant le premier, l'utilisateur
// saisissant celui qu'il a lu en premier, et l'échec devenant incompréhensible.
//
// On échoue franchement et l'appelant décide. Une relance visible par
// l'utilisateur (« renvoyer le code ») vaut mieux qu'une relance invisible.
// ============================================================================

// Les seuls statuts qui signifient que le message est parti ou partira.
// 100 Processed, 101 Sent, 102 Queued. Tout le reste est un échec.
const SUCCESS_STATUS_CODES = new Set([100, 101, 102]);

// Ce que veulent dire les échecs les plus probables, en clair. Sans cette
// table, un journal ne montre qu'un nombre — et personne ne sait si le
// problème vient du numéro, du compte, ou de l'opérateur.
const FAILURE_MEANINGS: Record<number, string> = {
  401: 'Le destinataire est inactif chez l’opérateur.',
  402: 'Le compte Africa’s Talking n’est pas approvisionné.',
  403: 'Le destinataire figure sur une liste de blocage.',
  404: 'Aucun opérateur ne dessert ce numéro.',
  405: 'Erreur interne chez Africa’s Talking.',
  406: 'Solde insuffisant sur le compte Africa’s Talking.',
  407: 'Le compte émetteur est inactif.',
  409: 'L’identifiant d’expéditeur (sender ID) n’est pas approuvé.',
  500: 'Numéro de téléphone invalide (le format E.164, avec +, est attendu).',
  501: 'Identifiant d’expéditeur inconnu.',
};

// Au-delà, on considère que la requête est perdue. Un SMS d'inscription qui
// met plus de quinze secondes n'aide plus personne, et laisser une requête HTTP
// pendre indéfiniment bloquerait la connexion de l'utilisateur avec elle.
const TIMEOUT_MS = 15_000;

interface AfricasTalkingRecipient {
  statusCode?: number;
  status?: string;
  number?: string;
  messageId?: string;
}

interface AfricasTalkingResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: AfricasTalkingRecipient[];
  };
}

@Injectable()
export class AfricasTalkingSmsProvider implements SmsProvider {
  private readonly logger = new Logger(AfricasTalkingSmsProvider.name);

  constructor(private readonly config: ConfigService) {}

  async send(to: string, message: string): Promise<void> {
    // Lu à l'usage et non à l'instanciation : Nest instancie tous les
    // fournisseurs déclarés, y compris celui-ci, même quand SMS_PROVIDER=console
    // est actif. Exiger la clé au démarrage empêcherait de développer sans compte.
    const apiKey = this.config.getOrThrow<string>('AFRICASTALKING_API_KEY');
    const username = this.config.getOrThrow<string>('AFRICASTALKING_USERNAME');
    const senderId = this.config.get<string>('AFRICASTALKING_SENDER_ID');

    const response = await this.post(this.endpointFor(username), {
      apiKey,
      username,
      to,
      message,
      senderId,
    });

    this.assertDelivered(response, to);
  }

  // ==========================================================================
  // LE BAC À SABLE SE DÉDUIT DU NOM D'UTILISATEUR
  //
  // Africa's Talking impose le nom d'utilisateur `sandbox` pour le bac à sable.
  // Le déduire plutôt que de le configurer séparément supprime toute une classe
  // d'erreurs : des identifiants de bac à sable envoyés à l'adresse de
  // production échouent avec un message d'authentification incompréhensible, et
  // — bien pire — des identifiants de PRODUCTION envoyés à l'adresse du bac à
  // sable feraient croire à des envois réussis qui n'atteignent personne.
  //
  // Une seule variable à renseigner, une incohérence de moins à commettre.
  // ==========================================================================
  private endpointFor(username: string): string {
    return username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';
  }

  private async post(
    endpoint: string,
    params: {
      apiKey: string;
      username: string;
      to: string;
      message: string;
      senderId?: string;
    },
  ): Promise<AfricasTalkingResponse> {
    const body = new URLSearchParams({
      username: params.username,
      to: params.to,
      message: params.message,
      // L'identifiant d'expéditeur doit être approuvé par les opérateurs. Tant
      // qu'il ne l'est pas, on ne l'envoie pas : un `from` non approuvé fait
      // rejeter le message (statut 409) au lieu de le laisser partir depuis un
      // numéro court par défaut.
      ...(params.senderId ? { from: params.senderId } : {}),
    });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apiKey: params.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      // Réseau injoignable ou délai dépassé. On ne sait pas si le message est
      // parti — d'où l'absence de nouvelle tentative automatique.
      this.logger.error(
        `Africa's Talking injoignable pour ${this.mask(params.to)} : ${
          cause instanceof Error ? cause.name : 'erreur inconnue'
        }`,
      );
      throw new Error('Échec de l’envoi du SMS : opérateur injoignable.');
    }

    if (!response.ok) {
      // Le corps d'erreur peut contenir le numéro : il n'est jamais recopié.
      this.logger.error(
        `Africa's Talking a refusé la requête (HTTP ${response.status}) pour ${this.mask(params.to)}.`,
      );
      throw new Error('Échec de l’envoi du SMS.');
    }

    try {
      return (await response.json()) as AfricasTalkingResponse;
    } catch {
      // Une réponse 2xx illisible ne prouve rien. La traiter comme un succès
      // serait exactement l'erreur que ce fichier cherche à éviter.
      this.logger.error(
        `Réponse Africa's Talking illisible pour ${this.mask(params.to)}.`,
      );
      throw new Error('Échec de l’envoi du SMS : réponse illisible.');
    }
  }

  // Le verdict réel, destinataire par destinataire.
  private assertDelivered(response: AfricasTalkingResponse, to: string): void {
    const recipients = response.SMSMessageData?.Recipients ?? [];

    // Aucun destinataire dans la réponse : le message n'a été routé nulle part.
    // C'est ce que rend l'API quand le numéro est malformé au point de ne pas
    // être reconnu.
    if (recipients.length === 0) {
      this.logger.error(
        `Africa's Talking n'a retenu aucun destinataire pour ${this.mask(to)} — ` +
          'numéro probablement hors format E.164.',
      );
      throw new Error('Échec de l’envoi du SMS : destinataire non routé.');
    }

    const failed = recipients.filter(
      (recipient) => !SUCCESS_STATUS_CODES.has(recipient.statusCode ?? -1),
    );
    if (failed.length === 0) return;

    for (const recipient of failed) {
      const code = recipient.statusCode ?? -1;
      this.logger.error(
        `SMS non délivré à ${this.mask(to)} — statut ${code} : ` +
          (FAILURE_MEANINGS[code] ??
            recipient.status ??
            'raison non documentée'),
      );
    }

    throw new Error('Échec de l’envoi du SMS : rejeté par l’opérateur.');
  }

  // Même masquage que le fournisseur console : les quatre derniers chiffres
  // suffisent à reconnaître un numéro dans un journal sans le divulguer.
  private mask(phone: string): string {
    return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
  }
}
