import type { EventHandler } from './event-delivery-store';

export interface EventHandlerRegistration {
  readonly handlerCode: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly handler?: EventHandler;
  readonly safeSummary?: (payload: unknown) => Readonly<Record<string, string | number | boolean | null>>;
}

export class EventHandlerRegistry {
  private readonly registrations = new Map<string, Readonly<EventHandlerRegistration>>();

  register(registration: EventHandlerRegistration): void {
    assertRegistration(registration);
    if (this.registrations.has(registration.handlerCode)) {
      throw new TypeError(`Event handler ${registration.handlerCode} is already registered`);
    }
    this.registrations.set(registration.handlerCode, Object.freeze({ ...registration }));
  }

  get(handlerCode: string): Readonly<EventHandlerRegistration> | undefined {
    return this.registrations.get(handlerCode);
  }

  has(handlerCode: string, eventType?: string, eventVersion?: number): boolean {
    const registration = this.registrations.get(handlerCode);
    if (!registration) return false;
    if (eventType === undefined && eventVersion === undefined) return true;
    return registration.eventType === eventType && registration.eventVersion === eventVersion;
  }

  resolve(handlerCode: string, eventType: string, eventVersion: number): EventHandler | undefined {
    const registration = this.registrations.get(handlerCode);
    if (!registration
      || registration.eventType !== eventType
      || registration.eventVersion !== eventVersion) return undefined;
    return registration.handler;
  }

  supportsEventType(eventType: string): boolean {
    return [...this.registrations.values()].some(registration => registration.eventType === eventType);
  }

  safeSummary(
    eventType: string,
    eventVersion: number,
    payload: unknown,
  ): Readonly<Record<string, string | number | boolean | null>> {
    const registration = [...this.registrations.values()].find(candidate => (
      candidate.eventType === eventType && candidate.eventVersion === eventVersion
    ));
    if (!registration?.safeSummary) throw new TypeError('Event payload summary is not registered');
    const summary = registration.safeSummary(payload);
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
      throw new TypeError('Event payload summary must be a scalar record');
    }
    for (const value of Object.values(summary)) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw new TypeError('Event payload summary accepts only scalar fields');
      }
    }
    return Object.freeze({ ...summary });
  }

  validate(): void {
    for (const registration of this.registrations.values()) assertRegistration(registration);
  }
}

function assertRegistration(registration: EventHandlerRegistration): void {
  if (!registration || typeof registration !== 'object') {
    throw new TypeError('Event handler registration must be an object');
  }
  if (typeof registration.handlerCode !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(registration.handlerCode)) {
    throw new TypeError('Event handler code must be a stable uppercase code');
  }
  if (typeof registration.eventType !== 'string' || registration.eventType.length === 0) {
    throw new TypeError('Event handler event type must be a non-empty string');
  }
  if (!Number.isSafeInteger(registration.eventVersion) || registration.eventVersion < 1) {
    throw new TypeError('Event handler event version must be a positive integer');
  }
  if (registration.handler !== undefined
    && (typeof registration.handler !== 'object' || typeof registration.handler.handle !== 'function')) {
    throw new TypeError('Event handler must expose an asynchronous handle function');
  }
  if (registration.safeSummary !== undefined && typeof registration.safeSummary !== 'function') {
    throw new TypeError('Event handler safe summary must be a function');
  }
}
