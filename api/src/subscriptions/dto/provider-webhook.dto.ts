import { IsIn, IsString } from 'class-validator';

export class ProviderPaymentWebhookDto {
  @IsString()
  providerReference: string;

  @IsIn(['CONFIRMED', 'FAILED'])
  status: 'CONFIRMED' | 'FAILED';
}
