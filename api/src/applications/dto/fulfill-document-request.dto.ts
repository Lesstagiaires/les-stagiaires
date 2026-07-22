import { IsString } from 'class-validator';

export class FulfillDocumentRequestDto {
  @IsString()
  digitalSafeDocumentId: string;
}
