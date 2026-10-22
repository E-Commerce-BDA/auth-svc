import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getPool } from '../db/pool.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  /**
   * Liveness: is this process able to answer HTTP? It deliberately performs no
   * dependency calls; a database outage must not fail liveness and trigger a
   * restart loop (`4.API-Design.md` §1.9).
   */
  checkLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: should traffic reach this process right now? The database is
   * the only wired dependency in v1.
   */
  async checkReadiness(): Promise<{
    status: 'ready';
    checks: { db: 'up' };
  }> {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ready', checks: { db: 'up' } };
    } catch (error) {
      this.logger.error(
        'Database connection failed',
        error instanceof Error ? error.stack : '',
      );
      // An object is used verbatim as the response body; a string would become
      // Nest's { statusCode, message, error } shape and break §1.9.
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { db: 'down' },
      });
    }
  }
}
