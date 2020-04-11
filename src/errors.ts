export namespace Errors {
  export class NotConnectedError extends Error {
    constructor(message?: string) {
      super(message ?? 'Not connected.');
      this.name = 'NotConnectedError';
    }
  }

  export class ProcedureNotFoundError extends Error {
    constructor() {
      super('Procedure not found.');
      this.name = 'ProcedureNotFoundError';
    }
  }

  export class InvalidJSONRPCError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'InvalidJSONRPCError';
    }
  }

  export class RequestError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'RequestError';
    }
  }
}
