/**
 * An alias for unique id, ex. rpc-message id, device token and so.
 */
import { Errors } from './errors';

export type Id = string;
/**
 * An alias for method names
 */
export type Name = string;

/**
 * Primitives that can be represented in the JSON structure
 */
export type JSONValue = object | [] | string | number | boolean | null;

namespace RPCMessages {
  /**
   * Special request for establishing the connection
   */
  export interface RPCConnect {
    type: MessageType.Connect;
    jsonrpc: '2.0';
    id: Id;
    method: 'connect';
    params: {
      id?: Id;
      result?: boolean;
      message?: string;
    };
  }

  /**
   * An error, if the sender rpc-call ended unexpectedly
   * @internal
   */
  export interface RPCError {
    type: MessageType.Error;
    jsonrpc: '2.0';
    id: Id;
    error: string;
  }

  /**
   * Malformed message
   * @internal
   */
  export interface RPCMalformed {
    type: MessageType.Malformed;
  }

  /**
   * Method params. Library supports only one argument for the method and it
   * must be an object (record with the different type which can be described
   * by the json object)
   * @internal
   */
  export interface RPCRequest {
    type: MessageType.Request;
    jsonrpc: '2.0';
    id: Id;
    method: Name;
    params: Record<string, any>;
  }

  /**
   * Result of the method execution. And json type
   * @internal
   */
  export interface RPCResponse {
    type: MessageType.Response;
    jsonrpc: '2.0';
    id: Id;
    result: JSONValue;
  }

  /**
   * Common structure of the JSON-RPC 2.0 message
   * @internal
   */
  export type RPCMessageType =
    | RPCMessages.RPCConnect
    | RPCMessages.RPCError
    | RPCMessages.RPCMalformed
    | RPCMessages.RPCRequest
    | RPCMessages.RPCResponse;
}

/**
 * A default context object. Every local RPC call have an object
 */
export interface RPCContext {
  [x: string]: any;
  id: Id;
  token?: Id;
}

/**
 * Describes different message types both directions: to the remote client and
 * from the remote client
 * @internal
 */
export enum MessageType {
  /**
   * Handshaking message. This is an internal type of a message which sends
   * only when the connection is established
   */
  Connect,
  /**
   * Major message type when the sender wants us to execute some method
   */
  Request,
  /**
   * Major message type when the sender sends us the result of the remote
   * procedure call
   */
  Response,
  /**
   * Represents an error message from the sender. It handles all executing errors
   * and also calling a nonexistent function
   */
  Error,
  /**
   * Any message that is not a valid JSON-RPC 2.0 message
   */
  Malformed,
}

/**
 * Returns the message from the received websocket data
 * @internal
 */
export function getMessage(data: string): RPCMessages.RPCMessageType {
  let message: Record<string, any>;
  try {
    message = JSON.parse(data);
  } catch (e) {
    return { type: MessageType.Malformed };
  }
  let messageType: RPCMessages.RPCMessageType;
  if (!message.id || message.jsonrpc !== '2.0') {
    messageType = { type: MessageType.Malformed };
  } else if ('method' in message && message.method === 'connect') {
    messageType = {
      type: MessageType.Connect,
      jsonrpc: '2.0',
      id: message.id,
      method: 'connect',
      params: message.params,
    };
  } else if ('method' in message) {
    messageType = {
      type: MessageType.Request,
      jsonrpc: '2.0',
      id: message.id,
      method: message.method,
      params: message.params,
    };
  } else if ('result' in message) {
    messageType = {
      type: MessageType.Response,
      jsonrpc: '2.0',
      id: message.id,
      result: message.result,
    };
  } else if ('error' in message) {
    messageType = {
      type: MessageType.Error,
      jsonrpc: '2.0',
      id: message.id,
      error: message.error,
    };
  } else {
    messageType = { type: MessageType.Malformed };
  }
  return messageType;
}

interface RequestParams {
  timeout: number;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  destructor: () => void;
}

/**
 * Common class for the remote procedure request. It hides inside the timeout
 * handling and also the resolve and reject functions for the returned promise
 * from the {@link Server.call} and {@link Client.call} methods
 * @internal
 */
export class Request {
  private timer: number;
  public readonly resolve: (result: any) => void;
  public readonly reject: (error: Error) => void;

  constructor({ timeout = 5000, resolve, reject, destructor }: RequestParams) {
    this.timer = (setTimeout(() => {
      this.reject(new Errors.RequestError('dual-rpc-ws request timeout'));
      destructor();
    }, timeout) as any) as number;
    this.resolve = resolve;
    this.reject = reject;
  }
}

export namespace RPCHelpers {
  export const RequestTimeout = 3000;

  export function rpcRequest(method: Name, params: any, id: Id): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id,
    });
  }

  export function rpcResponse(result: any = null, id: Id): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      result,
      id,
    });
  }

  export function rpcError(error: any, id: Id): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      error,
      id,
    });
  }
}
