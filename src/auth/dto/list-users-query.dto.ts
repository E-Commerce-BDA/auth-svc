import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListUsersQueryDTO {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage: number = 25;

  @IsOptional()
  @IsIn(['active', 'disabled', 'pending'], {
    message: 'Status must be active, disabled, or pending',
  })
  status?: 'active' | 'disabled' | 'pending';
}
