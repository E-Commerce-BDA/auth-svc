import {
    IsEmail,
    IsNotEmpty,
    IsString
} from "class-validator"
import { Transform } from "class-transformer"

export class LoginDTO {
    @Transform(({ value }: { value: any }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
    @IsEmail({}, { message: 'Please provide a valid email address' })
    email!: string

    @IsString({ message: 'Password must be a string' })
    @IsNotEmpty({ message: 'Password is required' })
    password!: string

}