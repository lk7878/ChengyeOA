export class ValidationCommandError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationCommandError';
  }
}

export class AlreadyInitializedError extends Error {
  readonly exitCode = 3;

  constructor(message: string) {
    super(message);
    this.name = 'AlreadyInitializedError';
  }
}

export class InconsistentSystemStateError extends Error {
  readonly exitCode = 4;

  constructor(message: string) {
    super(message);
    this.name = 'InconsistentSystemStateError';
  }
}

export class DatabaseStateError extends Error {
  readonly exitCode = 5;

  constructor(message: string) {
    super(message);
    this.name = 'DatabaseStateError';
  }
}

export class RecoveryDisabledError extends Error {
  readonly exitCode = 6;

  constructor(message: string) {
    super(message);
    this.name = 'RecoveryDisabledError';
  }
}

export class RecoveryWindowUnavailableError extends Error {
  readonly exitCode = 7;

  constructor(message: string) {
    super(message);
    this.name = 'RecoveryWindowUnavailableError';
  }
}
