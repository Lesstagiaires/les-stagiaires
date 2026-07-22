import { IsString } from 'class-validator';

export class SwitchRoleDto {
  @IsString()
  roleId: string;
}
