import { Inject, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { OutboxStorePort, Queryable } from '@ecom/messaging';
import { OUTBOX_STORE } from '@ecom/messaging/nest';
import type { UserRow } from '../db/rows.js';

/**
 * `userRegisteredPayloadSchema.displayName` allows 120 characters, while
 * `auth.users` stores first and last name in two `varchar(100)` columns. Joining
 * them can therefore reach 201, so the value is clipped to what the contract
 * accepts instead of letting the payload fail validation at write time.
 */
const DISPLAY_NAME_MAX = 120;

/**
 * Writes the `user.registered` event into `auth.outbox`.
 *
 * The write must happen inside the transaction that inserted the user row, so
 * the event and the account commit or roll back together.
 */
@Injectable()
export class AuthOutbox {
  constructor(@Inject(OUTBOX_STORE) private readonly store: OutboxStorePort) {}

  async recordUserRegistered(client: Queryable, user: UserRow): Promise<string> {
    const displayName = [user.first_name, user.last_name]
      .join(' ')
      .trim()
      .slice(0, DISPLAY_NAME_MAX);

    return this.store.write(client, {
      topic: 'user.registered',
      eventId: uuidv7(),
      aggregateType: 'user',
      aggregateId: user.id,
      // The transaction's own timestamp, not wall clock at publish time.
      occurredAt: user.created_at,
      payload: {
        userId: user.id,
        // PII rule: the id and an optional display name, never the email.
        ...(displayName ? { displayName } : {}),
        registeredAt: user.created_at.toISOString(),
      },
    });
  }
}
