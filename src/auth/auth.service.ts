import { ConflictException, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { RegisterDTO } from './dto/register.dto.js'
import { getPool } from '../db/pool.js';
import { createUser, findRoleBySlug, assignUserRole } from '../db/queries/users.sql.js';

@Injectable()
export class AuthService {
  async register(dto: RegisterDTO) {
    const userId = uuidv7()
    const passwordhash = await argon2.hash(dto.password)
    const client = await getPool().connect()
    let transactionStarted = false

    try {
      await client.query('BEGIN')
      transactionStarted = true

      const user = await createUser(client, {
        id: userId,
        email: dto.email,
        passwordHash: passwordhash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      })

      const role = await findRoleBySlug(client, { slug: 'customer' })
      if (!role) {
        await client.query('ROLLBACK')
        transactionStarted = false
        throw new Error('Customer role not found! Please Contact administrator.')
      }

      await assignUserRole(client, {
        userId: user.id,
        roleId: role.id,
      })

      await client.query('COMMIT')
      transactionStarted = false

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
        }
      }
    } catch (error: any) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK')
        } catch (rollbackError: any) {
          console.error('Failed to rollback transaction:', rollbackError.message)
        }
        transactionStarted = false
      }
      if (error.code === '23505') {
        throw new ConflictException('Email already exists')
      }
      throw error
    } finally {
      client.release()
    }

  }
}
