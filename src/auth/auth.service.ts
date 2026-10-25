import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { RegisterDTO } from './dto/register.dto.js';
import { LoginDTO } from './dto/login.dto.js';
import { getPool } from '../db/pool.js';
import {
  createUser,
  findRoleBySlug,
  assignUserRole,
  findUserByEmail,
  getUserRoleSlugs,
} from '../db/queries/users.sql.js';
import { createRefreshToken } from '../db/queries/tokens.sql.js';
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
}
