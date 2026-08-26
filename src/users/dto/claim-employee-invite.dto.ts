import { IsString } from 'class-validator';

export class ClaimEmployeeInviteDto {
  @IsString()
  cpf: string;
}
