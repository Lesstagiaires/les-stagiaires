import { Injectable, Logger } from '@nestjs/common';
import type {
  EmailProvider,
  EmailSendResult,
  OutboundEmail,
} from './email-provider.interface';

// Implémentation de développement : elle n'envoie rien, elle imprime.
//
// Le pendant exact de ConsoleSmsProvider, et pour la même raison : le
// développement et les tests d'intégration doivent pouvoir exercer tout le
// chemin — préférences, gabarit, langue, journalisation — sans dépendre d'un
// compte fournisseur ni expédier de vrais messages à de vraies personnes.
//
// Le corps HTML n'est PAS imprimé : il contient des données personnelles
// (CLAUDE.md §1) et n'a rien à faire dans un fichier de log, même en
// développement — les logs de dev finissent régulièrement collés dans des
// tickets.
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  send(message: OutboundEmail): Promise<EmailSendResult> {
    this.logger.log(
      `[e-mail simulé] à ${maskRecipient(message.to)} — « ${message.subject} »`,
    );
    return Promise.resolve({
      providerMessageId: `console-${Date.now()}`,
    });
  }
}

// Masque l'adresse dans les journaux : de quoi reconnaître un destinataire en
// diagnostic, pas de quoi constituer un fichier d'adresses depuis les logs.
function maskRecipient(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
