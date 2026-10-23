import {
    IsEmail,
    IsNotEmpty,
    IsString,
    Matches,
    MaxLength,
    MinLength
} from "class-validator";
import { Transform } from "class-transformer";

export class RegisterDTO {
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    @IsEmail({}, { message: 'Please provide a valid email address' })
    email!: string


    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters long' })
    @MaxLength(128, { message: 'Password must be smaller than 128 characters' })
    @Matches(/^(?=.*[a-zA-Z])(?=.*\d)/, { message: 'Password must contain at least one letter and one number' })
    password!: string

    @IsString()
    @IsNotEmpty({ message: 'First name is required' })
    @MaxLength(100, { message: 'First name must be under 100 characters' })
    firstName!: string

    @IsString()
    @IsNotEmpty({ message: 'Last name is required' })
    @MaxLength(100, { message: 'Last name must be under 100 characters' })
    lastName!: string

}