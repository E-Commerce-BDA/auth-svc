import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDTO } from './dto/register.dto.js';
import { LoginDTO } from './dto/login.dto.js';
import { RefreshDTO } from './dto/refresh.dto.js';
import { LogoutDTO } from './dto/logout.dto.js';
import { UpdateProfileDTO } from './dto/update-profile.dto.js';
import { ChangePasswordDTO } from './dto/change-password.dto.js';
import { CreateAddressDTO } from './dto/create-address.dto.js';
import { UpdateAddressDTO } from './dto/update-address.dto.js';
import { ListUsersQueryDTO } from './dto/list-users-query.dto.js';
import { UpdateUserStatusDTO } from './dto/update-user-status.dto.js';
import { CreateRoleDTO } from './dto/create-role.dto.js';
import { AssignRolesDTO } from './dto/assign-roles.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { Roles } from './decorators/roles.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDTO) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDTO) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDTO) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: LogoutDTO) {
    await this.authService.logout(dto?.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser('sub') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDTO,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body() dto: ChangePasswordDTO,
  ) {
    await this.authService.changePassword(userId, dto);
  }

  @Get('me/addresses')
  @UseGuards(JwtAuthGuard)
  async getAddresses(@CurrentUser('sub') userId: string) {
    return this.authService.getAddresses(userId);
  }

  @Post('me/addresses')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createAddress(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAddressDTO,
  ) {
    return this.authService.createAddress(userId, dto);
  }

  @Patch('me/addresses/:id')
  @UseGuards(JwtAuthGuard)
  async updateAddress(
    @CurrentUser('sub') userId: string,
    @Param('id') addressId: string,
    @Body() dto: UpdateAddressDTO,
  ) {
    return this.authService.updateAddress(userId, addressId, dto);
  }

  @Delete('me/addresses/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAddress(
    @CurrentUser('sub') userId: string,
    @Param('id') addressId: string,
  ) {
    await this.authService.deleteAddress(userId, addressId);
  }

  // --- Admin RBAC & User Management Endpoints ---

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async listUsers(@Query() query: ListUsersQueryDTO) {
    return this.authService.listUsers(query);
  }

  @Patch('users/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateUserStatus(
    @Param('id') userId: string,
    @Body() dto: UpdateUserStatusDTO,
  ) {
    return this.authService.updateUserStatus(userId, dto.status);
  }

  @Get('roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getRoles() {
    return this.authService.getRoles();
  }

  @Post('roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  async createRole(@Body() dto: CreateRoleDTO) {
    return this.authService.createRole(dto);
  }

  @Patch('users/:id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async assignUserRoles(
    @Param('id') userId: string,
    @Body() dto: AssignRolesDTO,
  ) {
    return this.authService.assignUserRoles(userId, dto.roleSlugs);
  }
}
