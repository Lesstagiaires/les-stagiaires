import { IsString } from 'class-validator';

export class SwitchActiveRoleDto {
  @IsString()
  roleId: string;
}
