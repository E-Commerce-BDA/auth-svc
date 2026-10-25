import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateAddressDTO {
  @IsOptional()
  @IsString({ message: 'Type must be a string' })
  @MaxLength(10, { message: 'Type must be under 10 characters' })
  type?: string;

  @IsOptional()
  @IsString({ message: 'Label must be a string' })
  @MaxLength(50, { message: 'Label must be under 50 characters' })
  label?: string;

  @IsOptional()
  @IsString({ message: 'Address line 1 must be a string' })
  @MaxLength(255, { message: 'Address line 1 must be under 255 characters' })
  line1?: string;

  @IsOptional()
  @IsString({ message: 'Address line 2 must be a string' })
  @MaxLength(255, { message: 'Address line 2 must be under 255 characters' })
  line2?: string;

  @IsOptional()
  @IsString({ message: 'City must be a string' })
  @MaxLength(100, { message: 'City must be under 100 characters' })
  city?: string;

  @IsOptional()
  @IsString({ message: 'State must be a string' })
  @MaxLength(100, { message: 'State must be under 100 characters' })
  state?: string;

  @IsOptional()
  @IsString({ message: 'Postal code must be a string' })
  @MaxLength(20, { message: 'Postal code must be under 20 characters' })
  postalCode?: string;

  @IsOptional()
  @IsString({ message: 'Country must be a string' })
  @MaxLength(2, { message: 'Country code must be 2 characters (e.g. US)' })
  country?: string;

  @IsOptional()
  @IsBoolean({ message: 'isDefault must be a boolean' })
  isDefault?: boolean;
}
