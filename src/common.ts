/**
 * An alias for unique id, ex. rpc-message id, device token and so.
 */
export type Id = string;
/**
 * An alias for method names
 */
export type Name = string;

/**
 * Common structure of the JSON-RPC 2.0 message
 * @internal
 */
export interface RPCMessage {
  /**
   * Protocol version
   */
  jsonrpc: string;
  /**
   * Message unique id
   */
  id: Id;
  /**
   * Method name
   */
  method: Name;
  /**
   * Method params. Library supports only one argument for the method and it
   * must be an object (record with the different type which can be described
   * by the json object)
   */
  params: Record<string, any>;
  /**
   * Result of the method execution. And json type
   */
  result: any;
  /**
   * An error, if the sender rpc-call ended unexpectedly
   */
  error: string;
}

/**
 * A default context object. Every local RPC call have an object
 */
export interface RPCContext {
  id: Id;
  token: Id;
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
 * Returns the message type and a js-object which represents the message
 * @param data A message buffer received from the client
 * @internal
 */
export function getMessageAndType(data: string): [MessageType, RPCMessage?] {
  let message: RPCMessage;
  try {
    message = JSON.parse(data);
  } catch (e) {
    return [MessageType.Malformed];
  }
  if (!message.id || message.jsonrpc !== '2.0') {
    return [MessageType.Malformed];
  }
  let type: MessageType;
  if ('method' in message && message.method === 'connect') {
    type = MessageType.Connect;
  } else if ('method' in message) {
    type = MessageType.Request;
  } else if ('result' in message) {
    type = MessageType.Response;
  } else if ('error' in message) {
    type = MessageType.Error;
  } else {
    type = MessageType.Malformed;
  }
  return [type, message];
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
      this.reject(new Error('dual-rpc-ws request timeout'));
      destructor();
    }, timeout) as any) as number;
    this.resolve = resolve;
    this.reject = reject;
  }
}

export function rpcRequest(method: Name, params: any, id: Id): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id,
  });
}

export function rpcResponse(result: any, id: Id): string {
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
