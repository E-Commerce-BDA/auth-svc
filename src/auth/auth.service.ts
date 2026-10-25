import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { RegisterDTO } from './dto/register.dto.js';
import { LoginDTO } from './dto/login.dto.js';
import { RefreshDTO } from './dto/refresh.dto.js';
import { UpdateProfileDTO } from './dto/update-profile.dto.js';
import { ChangePasswordDTO } from './dto/change-password.dto.js';
import { getPool } from '../db/pool.js';
import {
  createUser,
  findRoleBySlug,
  assignUserRole,
  findUserByEmail,
  findUserById,
  updateUserProfile,
  updateUserPassword,
  getUserRoleSlugs,
} from '../db/queries/users.sql.js';
import {
  createRefreshToken,
  findRefreshTokenByHash,
  revokeRefreshToken,
  revokeTokenFamily,
  findActiveFamilyToken,
  revokeAllUserTokens,
} from '../db/queries/tokens.sql.js';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async register(dto: RegisterDTO) {
    const userId = uuidv7();
    const passwordhash = await argon2.hash(dto.password);
    const client = await getPool().connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const user = await createUser(client, {
        id: userId,
        email: dto.email,
        passwordHash: passwordhash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });

      const role = await findRoleBySlug(client, { slug: 'customer' });
      if (!role) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        throw new Error('Customer role not found! Please Contact administrator.');
      }

      await assignUserRole(client, {
        userId: user.id,
        roleId: role.id,
      });

      await client.query('COMMIT');
      transactionStarted = false;

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
        },
      };
    } catch (error: any) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError: any) {
          console.error('Failed to rollback transaction:', rollbackError.message);
        }
        transactionStarted = false;
      }
      if (error.code === '23505') {
        throw new ConflictException('Email already exists');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async login(dto: LoginDTO) {
    const client = await getPool().connect();
    try {
      const user = await findUserByEmail(client, { email: dto.email });
      if (!user) {
        throw new UnauthorizedException('Invalid email or password');
      }

      if (user.status !== 'active') {
        throw new UnauthorizedException('Account is disabled');
      }

      const validPassword = await argon2.verify(user.password_hash, dto.password);
      if (!validPassword) {
        throw new UnauthorizedException('Invalid email or password');
      }

      const roles = await getUserRoleSlugs(client, { userId: user.id });

      const accessToken = await this.jwtService.signAsync({
        sub: user.id,
        email: user.email,
        roles,
      });

      const rawRefreshToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
      const tokenId = uuidv7();
      const familyId = uuidv7();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await createRefreshToken(client, {
        id: tokenId,
        userId: user.id,
        familyId,
        tokenHash,
        expiresAt,
      });

      await client.query(
        'UPDATE auth.users SET last_login_at = now() WHERE id = $1',
        [user.id],
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          roles,
        },
        accessToken,
        refreshToken: rawRefreshToken,
      };
    } finally {
      client.release();
    }
  }

  async refresh(dto: RefreshDTO) {
    const tokenHash = createHash('sha256').update(dto.refreshToken).digest('hex');
    const client = await getPool().connect();

    try {
      const token = await findRefreshTokenByHash(client, { tokenHash });
      if (!token) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      if (new Date(token.expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      // Check if token was previously revoked (theft or grace period reuse)
      if (token.revoked_at !== null) {
        const revokedTime = new Date(token.revoked_at).getTime();
        const diff = Date.now() - revokedTime;

        // Grace window ONLY applies if there is an active unrevoked token in this family
        const activeFamilyToken = await findActiveFamilyToken(client, { familyId: token.family_id });

        if (activeFamilyToken && diff < 10000) {
          const user = await findUserById(client, { id: token.user_id });
          if (!user || user.status !== 'active') {
            throw new UnauthorizedException('Account is disabled');
          }
          const roles = await getUserRoleSlugs(client, { userId: user.id });
          const accessToken = await this.jwtService.signAsync({
            sub: user.id,
            email: user.email,
            roles,
          });

          return {
            accessToken,
            refreshToken: dto.refreshToken,
          };
        }

        // Theft detected (>10s or whole family already revoked): Revoke entire family!
        await revokeTokenFamily(client, { familyId: token.family_id });
        throw new UnauthorizedException('Session terminated due to security violation');
      }

      // Normal rotation:
      const user = await findUserById(client, { id: token.user_id });
      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('Account is disabled');
      }

      // Revoke current token
      await revokeRefreshToken(client, { tokenId: token.id });

      // Create new refresh token with same family_id
      const rawRefreshToken = randomBytes(32).toString('hex');
      const newTokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
      const newTokenId = uuidv7();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await createRefreshToken(client, {
        id: newTokenId,
        userId: user.id,
        familyId: token.family_id,
        tokenHash: newTokenHash,
        expiresAt,
      });

      const roles = await getUserRoleSlugs(client, { userId: user.id });
      const accessToken = await this.jwtService.signAsync({
        sub: user.id,
        email: user.email,
        roles,
      });

      return {
        accessToken,
        refreshToken: rawRefreshToken,
      };
    } finally {
      client.release();
    }
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) {
      return;
    }
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const client = await getPool().connect();
    try {
      const token = await findRefreshTokenByHash(client, { tokenHash });
      if (token && token.revoked_at === null) {
        await revokeRefreshToken(client, { tokenId: token.id });
      }
    } finally {
      client.release();
    }
  }

  async getProfile(userId: string) {
    const client = await getPool().connect();
    try {
      const user = await findUserById(client, { id: userId });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const roles = await getUserRoleSlugs(client, { userId: user.id });
      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          avatarUrl: user.avatar_url,
          status: user.status,
          roles,
          lastLoginAt: user.last_login_at,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      };
    } finally {
      client.release();
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDTO) {
    const client = await getPool().connect();
    try {
      const user = await updateUserProfile(client, {
        id: userId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        avatarUrl: dto.avatarUrl,
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const roles = await getUserRoleSlugs(client, { userId: user.id });
      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phone: user.phone,
          avatarUrl: user.avatar_url,
          status: user.status,
          roles,
          lastLoginAt: user.last_login_at,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
      };
    } finally {
      client.release();
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDTO) {
    const client = await getPool().connect();
    try {
      const user = await findUserById(client, { id: userId });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const isValid = await argon2.verify(user.password_hash, dto.currentPassword);
      if (!isValid) {
        throw new UnauthorizedException('Current password incorrect');
      }

      const newPasswordHash = await argon2.hash(dto.newPassword);
      await updateUserPassword(client, { id: userId, passwordHash: newPasswordHash });

      // Security rule: revoke all existing sessions for this user!
      await revokeAllUserTokens(client, { userId });
    } finally {
      client.release();
    }
  }
}
