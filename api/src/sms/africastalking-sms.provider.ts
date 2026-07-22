import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from './sms-provider.interface';

@Injectable()
export class AfricasTalkingSmsProvider implements SmsProvider {
  private readonly logger = new Logger(AfricasTalkingSmsProvider.name);
  private readonly endpoint =
    'https://api.africastalking.com/version1/messaging';

  constructor(private readonly config: ConfigService) {}

  async send(to: string, message: string): Promise<void> {
    // Vérifié ici, à l'usage réel, et non à l'instanciation : Nest instancie tous les
    // providers déclarés (donc celui-ci aussi) même quand SMS_PROVIDER=console est actif.
    const apiKey = this.config.getOrThrow<string>('AFRICASTALKING_API_KEY');
    const username = this.config.getOrThrow<string>('AFRICASTALKING_USERNAME');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ username, to, message }).toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `Échec d'envoi SMS via Africa's Talking (${response.status}): ${body}`,
      );
      throw new Error("Échec de l'envoi du SMS");
    }
  }
}
