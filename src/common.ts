export type id = string;
export type name = string;

export interface RPCMessage {
  jsonrpc: string;
  id: string;
  method: string;
  params: Record<string, any>;
  result: any;
  error: any;
}

export enum MessageType {
  Connect,
  Request,
  Response,
  Error,
  Malformed,
}

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
  if (
    'method' in message &&
    message.method === 'connect' &&
    message.params?.id
  ) {
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

export class Request {
  private timer: number;
  public resolve: Function;
  public reject: Function;

  constructor({
    timeout = 5000,
    resolve,
    reject,
    destructor,
  }: {
    timeout: number;
    resolve: Function;
    reject: Function;
    destructor: Function;
  }) {
    this.timer = (setTimeout(() => {
      this.reject(new Error(`dual-rpc-ws request timeout`));
      destructor();
    }, timeout) as any) as number;
    this.resolve = resolve;
    this.reject = reject;
  }
}

export function rpcRequest(method: name, params: any, id: id): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
    id,
  });
}

export function rpcResponse(result: any, id: id): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    result,
    id,
  });
}

export function rpcError(error: any, id: id): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    error,
    id,
  });
}
