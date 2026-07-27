import { IsOptional, IsString } from 'class-validator';

export class AssignPartnershipRequestDto {
  // Absent ou null : désassigne la demande.
  @IsOptional()
  @IsString()
  assigneeId?: string | null;
}
