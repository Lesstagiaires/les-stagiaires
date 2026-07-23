import { IsEnum, IsPhoneNumber } from 'class-validator';
import { OrganizationMemberRole } from '../../../generated/prisma/enums';

export class InviteMemberDto {
  @IsPhoneNumber(undefined, {
    message:
      'Numéro de téléphone invalide (format international requis, ex: +237...)',
  })
  phone: string;

  @IsEnum(OrganizationMemberRole)
  role: OrganizationMemberRole;
}
