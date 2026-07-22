import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  send(to: string, message: string): Promise<void> {
    const masked = to.slice(0, -4).replace(/./g, '*') + to.slice(-4);
    this.logger.warn(
      `[SMS_PROVIDER=console] Aucun SMS réel envoyé — destinataire ${masked} :\n${message}`,
    );
    return Promise.resolve();
  }
}
