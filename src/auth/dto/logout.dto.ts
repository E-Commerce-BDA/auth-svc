import { IsOptional, IsString } from 'class-validator';

export class LogoutDTO {
  @IsOptional()
  @IsString({ message: 'Refresh token must be a string' })
  refreshToken?: string;
}
