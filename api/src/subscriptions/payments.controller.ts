import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ProviderPaymentWebhookDto } from './dto/provider-webhook.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Appelé par le prestataire de paiement lui-même, jamais par l'application mobile ni
  // par un utilisateur connecté — authentifié par un secret partagé propre au provider
  // (en-tête X-Webhook-Secret), pas par un jeton JWT utilisateur (CLAUDE.md §6).
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('webhooks/:provider')
  handleWebhook(
    @Param('provider') provider: string,
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() dto: ProviderPaymentWebhookDto,
  ) {
    return this.payments.handleProviderCallback(provider, secret, dto);
  }
}
