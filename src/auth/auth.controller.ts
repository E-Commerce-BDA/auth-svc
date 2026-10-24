import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDTO } from './dto/register.dto.js';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDTO) {
    const result = await this.authService.register(dto);
    return result;
  }
}
