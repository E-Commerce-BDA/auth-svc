import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { getPool } from '../db/pool.js';
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  async checkDatabaseConnection(): Promise<{status: string}> {
    try {
      await getPool().query('SELECT 1'); // Simple query to test the connection
      return { status: 'healthy' };
    } catch (error) {
      this.logger.error('Database connection failed', error instanceof Error ? error.stack : '');
      throw new ServiceUnavailableException('Database connection failed');
    }
  }
}
