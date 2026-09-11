abstract class EventHandlerError extends Error {
  readonly code: string;

  protected constructor(name: string, code: string) {
    super(code);
    this.name = name;
    this.code = code;
  }
}

export class RetryableEventError extends EventHandlerError {
  constructor(code: string) {
    super('RetryableEventError', code);
  }
}

export class PermanentEventError extends EventHandlerError {
  constructor(code: string) {
    super('PermanentEventError', code);
  }
}
