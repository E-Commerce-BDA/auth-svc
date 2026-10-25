import { IsIn, IsNotEmpty } from 'class-validator';

export class UpdateUserStatusDTO {
  @IsNotEmpty({ message: 'Status is required' })
  @IsIn(['active', 'disabled', 'pending'], {
    message: 'Status must be active, disabled, or pending',
  })
  status!: 'active' | 'disabled' | 'pending';
}
