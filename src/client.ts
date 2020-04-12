import { v4 } from 'react-native-uuid';
import {
  getMessage,
  Id,
  JSONValue,
  MessageType,
  Name,
  Request,
  RPCContext,
  RPCHelpers,
} from './common';
import { Errors } from './errors';
import NotConnectedError = Errors.NotConnectedError;

export interface ClientOptions {
  /**
   * Unique id for the client
   */
  token: Id;
  /**
   * Server's address ex. `wss://192.168.1.1/ws`
   */
  address: string;
  /**
   * The function that will be called when the connection is established
   * @param result The result of the handshaking. If true - everything is ok.
   * Otherwise - server doesn't allow connection and the websocket is closed
   */
  handshake?: (result: boolean) => void;
  /**
   * Optional function to define initial context for the {@link Client.register}
   * handlers. By default it returns the {@link RPCContext} object
   * @param ctx An object with the `id` property. Where `id` - is a unique
   * method call identifier
   * @example
   * ```typescript
   * const client = new Client({
   *   ...
   *   prepareContext: (ctx) => ({ ...ctx, useWS: true }),
   * });
   * client.register('ping', (params, context) => {
   *   console.log(context.id, 'client ping', params, ctx.useWS);
   * });
   * ```
   */
  prepareContext?: (ctx: RPCContext) => any;
  /**
   * Set of protocols inherited from {@link WebSocket.constructor}
   */
  protocols?: string | string[];
}

/**
 * RPC websocket client class which establishes the connection to the server.
 * It inherits from browser's Websocket class, but for the connection you need
 * to provide the unique client token in the constructor to let the server sends
 * you method call using it.
 * This class can {@link Client.register|register} any method to call it by the
 * server.
 * And also can {@link Client.call|call} any method on the server and receive
 * response data.
 *
 * The main parts of this class are:
 * - {@link Client.register|register} method to handle clients' calls
 * - {@link Client.call|call} method to execute clients' methods
 *
 * @example
 * ```typescript
 * import Client from '@noveo/dual-rpc-ws/client';
 * const client = new Client({
 *   token: 'id13',
 *   address: 'ws://192.168.0.80:8080',
 *   handshake: (connected) => {
 *     console.log('connected', connected);
 *     this.call(token, 'hi', {message: 'hello from client'});
 *   }
 * });
 * client.register('hi', (params, context) => {
 *   console.log('client hi, call id:', context.id);
 *   return Promise.resolve(`${token}, hello`);
 * });
 * client.addEventListener('close', () => {
 *   console.log('connection closed');
 * });
 * ```
 */
export default class Client extends WebSocket {
  private methods: Map<
    Name,
    (
      params: Record<string, any>,
      ctx: RPCContext,
    ) => Promise<JSONValue> | JSONValue | undefined
  > = new Map();

  private requests: Map<Id, Request> = new Map();

  handshake: (connected: boolean) => void = () => {};

  private readonly prepareContext: (ctx: RPCContext) => any = (ctx) => ctx;

  /**
   * Connect to the server using an address and unique id that specifies the client
   * @param params An object which passed out to define all the main properties
   * of the server. Notable fields are: {@link ClientOptions.address},
   * {@link ClientOptions.handshake} and {@link ClientOptions.prepareContext}.
   */
  constructor(params: ClientOptions) {
    super(params.address, params.protocols);

    if (params.handshake) {
      this.handshake = params.handshake;
    }
    if (params.prepareContext) {
      this.prepareContext = params.prepareContext;
    }

    this.addEventListener('open', () => {
      this.send(RPCHelpers.rpcRequest('connect', { id: params.token }, v4()));
    });

    this.addEventListener('message', async (event) => {
      const message = getMessage(event.data);
      switch (message.type) {
        case MessageType.Malformed:
          throw new Errors.InvalidJSONRPCError(
            `Malformed message: ${event.data}`,
          );
        case MessageType.Connect:
          this.handshake(message.params.result!);
          break;
        case MessageType.Request:
          const method = this.methods.get(message.method);
          if (!method) {
            return this.send(
              RPCHelpers.rpcError(`Procedure not found.`, message.id),
            );
          }
          try {
            const result = await method.call(
              this,
              message.params,
              this.prepareContext({ id: message.id }),
            );
            this.send(RPCHelpers.rpcResponse(result, message.id));
          } catch (error) {
            this.send(RPCHelpers.rpcError(error.message, message.id));
          }
          break;
        case MessageType.Response:
        case MessageType.Error:
          const request = this.requests.get(message.id);
          if (!request) {
            throw new Errors.RequestError(`Wrong request id: ${message.id}`);
          }
          message.type === MessageType.Response
            ? request.resolve(message.result)
            : request.reject(
                message.error === 'Procedure not found.'
                  ? new Errors.ProcedureNotFoundError()
                  : new Errors.RequestError(message.error),
              );
          this.requests.delete(message.id);
          break;
      }
    });
  }

  /**
   * Call the server method using params as one argument construction.
   * @return Returns a Promise with the JSON response from the client. It can be an
   * object, an array or a primitive.
   * @param method The name of the remote method to call
   * @param params Method arguments
   * @throws one of these errors:
   * - When the method doesn't present on the server side
   * - When the method call on the server triggered an exception
   */
  async call(
    method: string,
    params?: Record<string, any>,
  ): Promise<object | [] | string | number | boolean | null> {
    if (this.readyState !== this.OPEN) {
      throw new Errors.NotConnectedError();
    }
    const id = v4();
    return new Promise((resolve, reject) => {
      const request = new Request({
        timeout: 5000,
        resolve,
        reject,
        destructor: () => {
          this.requests.delete(id);
        },
      });
      this.requests.set(id, request);
      this.send(RPCHelpers.rpcRequest(method, params ?? null, id));
    });
  }

  /**
   * Register the method on the client side, handler must return an object or a Promise\<object\>
   * which will be held on the server side
   * @example
   * ```typescript
   * client.register('ping', (params) => {
   *   console.log('client ping', params);
   *   return Promise.resolve({ client: 'pong' });
   * });
   * ```
   * You can throw an exception in the handler and on the caller side the server
   * will catch the rejection of the calling promise.
   * @example
   * ```typescript
   * client.register('exception', () => {
   *   throw new Error('client exception');
   * });
   *
   * // server
   * server.call('<YOUR_TOKEN>', 'exception', {})
   *   .catch((e) => console.log(e.message)); // prints "client exception"
   * ```
   *
   * If the function does not return a value, a value of `null` will be obtained
   * on the client side. Because there is no `undefined` value in the JSON
   * representation.
   *
   * @param method
   * @param handler
   */
  register(
    method: Name,
    handler: (
      params: Record<string, any>,
      ctx: RPCContext,
    ) => Promise<JSONValue> | JSONValue | undefined,
  ) {
    this.methods.set(method, handler);
  }

  /**
   * Unregister the method on the client side
   * @param method
   */
  unregister(method: Name): void {
    this.methods.delete(method);
  }
}

class ReconnectingClientEvent implements Event {
  constructor() {}
  readonly AT_TARGET: number = 0;
  readonly BUBBLING_PHASE: number = 1;
  readonly CAPTURING_PHASE: number = 2;
  readonly NONE: number = 3;
  readonly bubbles: boolean = false;
  cancelBubble: boolean = false;
  readonly cancelable: boolean = false;
  readonly composed: boolean = false;
  readonly currentTarget: null;
  readonly defaultPrevented: boolean = false;
  readonly eventPhase: number = 0;
  readonly isTrusted: boolean = false;
  returnValue: boolean = false;
  readonly srcElement: null;
  readonly target: null;
  readonly timeStamp: number = Date.now();
  readonly type: string = 'ReconnectingClientEvent';
  composedPath(): EventTarget[] {
    return [];
  }
  initEvent(): void {}
  preventDefault(): void {}
  stopImmediatePropagation(): void {}
  stopPropagation(): void {}
}

type ReconnectingClientEventMap = {
  reconnect: ReconnectingClientEvent;
};

export class ReconnectingClient {
  private instance?: Client;

  private readonly params: ClientOptions;

  private interval = 5000;

  private serverRejected = false;

  private listeners: Map<
    Name,
    Map<
      EventListenerOrEventListenerObject,
      boolean | AddEventListenerOptions | undefined
    >
  > = new Map();

  private methods: Map<
    Name,
    (
      params: Record<string, any>,
      ctx: RPCContext,
    ) => Promise<JSONValue> | JSONValue | undefined
  > = new Map();

  constructor(params: ClientOptions) {
    this.params = params;
  }

  async connect(): Promise<Client> {
    return new Promise((resolve, reject) => {
      this.instance = new Client({
        ...this.params,
        handshake: (connected) => {
          if (connected) {
            if (this.instance) {
              this.attachMethodsAndListeners();
              this.dispatchEvent('reconnect', new ReconnectingClientEvent());
            }
            resolve(this.instance);
          } else {
            this.serverRejected = true;
            reject(
              new Errors.NotConnectedError(
                `The server rejected the connection`,
              ),
            );
          }
        },
      });
      /*
      this.instance.addEventListener('error', (event) => {
        console.log(event);
        // reject(event);
      });
      */
      this.instance.addEventListener('close', async (_event) => {
        if (!this.serverRejected) {
          this.reconnect();
        }
      });
    });
  }

  private reconnect() {
    setTimeout(() => this.connect(), this.interval);
  }

  call(
    method: string,
    params?: Record<string, any>,
  ): Promise<object | [] | string | number | boolean | null> {
    if (this.instance) {
      return this.instance.call(method, params);
    } else {
      throw new NotConnectedError();
    }
  }

  register(
    method: string,
    handler: (
      params: Record<string, any>,
      ctx: RPCContext,
    ) => Promise<JSONValue> | JSONValue | undefined,
  ) {
    this.methods.set(method, handler);
    if (this.instance) {
      this.instance.register(method, handler);
    }
  }

  unregister(method: Name): void {
    this.methods.delete(method);
    if (this.instance) {
      this.instance.unregister(method);
    }
  }

  on(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.addEventListener(type, listener, options);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.set(listener, options);
    } else {
      this.listeners.set(type, new Map([[listener, options]]));
    }
    if (this.instance) {
      this.instance.addEventListener(type, listener, options);
    }
  }

  emit<K extends keyof ReconnectingClientEventMap>(
    type: K,
    event: ReconnectingClientEventMap[K],
  ): void {
    this.dispatchEvent(type, event);
  }

  dispatchEvent<K extends keyof ReconnectingClientEventMap>(
    type: K,
    event: ReconnectingClientEventMap[K],
  ): void {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers.keys()) {
      if ('handleEvent' in handler) {
        handler.handleEvent(event);
      } else {
        handler(event);
      }
    }
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      typeListeners.delete(listener);
    }
    if (this.instance) {
      this.instance.removeEventListener(type, listener);
    }
  }

  removeAllListeners() {
    /* if (this.instance) {
      for (const typeListeners of  )
    } */
  }

  private attachMethodsAndListeners() {
    if (this.instance) {
      for (const [method, handler] of this.methods) {
        this.instance.register(method, handler);
      }
      for (const [type, listeners] of this.listeners) {
        for (const [listener, options] of listeners) {
          this.addEventListener(type, listener, options);
        }
      }
    }
  }
}
