import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  PartnershipRequestOrgType,
  PartnershipRequestReason,
} from '../../../generated/prisma/enums';

export class CreatePartnershipRequestDto {
  @IsString()
  @Length(2, 200)
  organizationName: string;

  @IsEnum(PartnershipRequestOrgType)
  organizationType: PartnershipRequestOrgType;

  @IsString()
  @Length(2, 200)
  contactName: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactTitle?: string;

  @IsPhoneNumber(undefined, {
    message:
      'Numéro de téléphone invalide (format international requis, ex: +237...)',
  })
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  @Length(2, 100)
  country: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsEnum(PartnershipRequestReason)
  reason: PartnershipRequestReason;

  @IsString()
  @Length(3, 200)
  subject: string;

  @IsString()
  @Length(10, 4000)
  description: string;
}
