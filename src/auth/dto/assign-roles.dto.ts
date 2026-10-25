import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class AssignRolesDTO {
  @IsArray({ message: 'roleSlugs must be an array' })
  @ArrayNotEmpty({ message: 'roleSlugs must not be empty' })
  @IsString({ each: true, message: 'Each role slug must be a string' })
  roleSlugs!: string[];
}
