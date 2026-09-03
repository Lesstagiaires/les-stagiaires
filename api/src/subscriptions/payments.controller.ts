import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PAYMENT_GATEWAY_REGISTRY } from '../payments/payment-gateway-provider.interface';
import type { AccessTokenPayload } from '../auth/token.service';
import { Inject } from '@nestjs/common';
import { PaymentGatewayRegistry } from '../payments/payment-gateway.registry';
import type { Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ProviderPaymentWebhookDto } from './dto/provider-webhook.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_GATEWAY_REGISTRY)
    private readonly registry: PaymentGatewayRegistry,
  ) {}

  @Get('methods')
  listMethods(@CurrentUser() user: AccessTokenPayload) {
    return this.registry.available(user.countryCode ?? 'CM');
  }

  // Appelé par le prestataire de paiement lui-même, jamais par l'application mobile ni
  // par un utilisateur connecté — authentifié par une signature HMAC propre au provider
  // (en-tête X-Webhook-Signature), pas par un jeton JWT utilisateur (CLAUDE.md §6).
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('webhooks/:provider')
  handleWebhook(
    @Param('provider') provider: string,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() dto: ProviderPaymentWebhookDto,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.payments.handleProviderCallback(
      provider,
      signature,
      dto,
      request.rawBody,
    );
  }
}
