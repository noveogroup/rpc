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
   * @ignore
   * @internal
   */
  errorHandler?: (error: Error) => any;
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

  private readonly errorHandler: (error: Error) => any = () => {};

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
    if (params.errorHandler) {
      this.errorHandler = params.errorHandler;
    }

    this.addEventListener('open', () => {
      this.send(RPCHelpers.rpcRequest('connect', { id: params.token }, v4()));
    });

    this.addEventListener('message', async (event) => {
      const message = getMessage(event.data);
      switch (message.type) {
        case MessageType.Malformed:
          return this.errorHandler(
            new Errors.InvalidJSONRPCError(`Malformed message: ${event.data}`),
          );
        // throw new Errors.InvalidJSONRPCError(
        //   `Malformed message: ${event.data}`,
        // );
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
            return this.errorHandler(
              new Errors.RequestError(`Wrong request id: ${message.id}`),
            );
            // throw new Errors.RequestError(`Wrong request id: ${message.id}`);
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
   * - {@link Errors.ProcedureNotFoundError} When the method doesn't present on
   * the server side
   * - {@link Errors.RequestError} When the method call on the server
   * triggered an exception
   * - {@link Errors.NotConnectedError} When the socket isn't connected to the
   * server
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
        timeout: RPCHelpers.RequestTimeout,
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

/**
 * @ignore
 */
class CustomEvent implements Event {
  type: string;
  detail: any;
  constructor(type?: Name, options?: { detail: any }) {
    this.type = type ?? 'CustomEvent';
    if (options?.detail) {
      this.detail = options.detail;
    }
  }
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
  composedPath(): EventTarget[] {
    return [];
  }
  initEvent(): void {}
  preventDefault(): void {}
  stopImmediatePropagation(): void {}
  stopPropagation(): void {}
}

/**
 * @ignore
 */
type ReconnectingClientEventMap = {
  connect: CustomEvent;
  connectError: CustomEvent;
  error: CustomEvent;
};

/**
 * A wrapper around the {@link Client} class. It has almost the same methods and
 * events as the Client class, with the exception of the connection sequence.
 * So please refer documentation to the {@link Client} class for the similar
 * methods.
 *
 * The connection sequence looks like follows:
 * ```typescript
 * const client = new ReconnectingClient() // creates an instance
 *                 🠗
 *       client.register('method1', handler1);
 *       await client.init()
 *       client.register('method2', handler2);
 *  // inits the connection:
 *  // ⌛ client now tries to connect to the server
 *                 🠗
 *  // when the client establishes a websocket connection, it can
 *  // 🛑 reject the promise and emits `connectError` event if server refuses
 *  //   the client to connect with its token. Thus it stops any connection
 *  //   attempts until you execute `init` method again.
 *  // 👌 resolve the promise and emits `connect` event if the server accepts
 *  //   the connection.
 *                 🠗
 *       await client.call('serverMethod' {...args});
 *       client.register('method3', handler3);
 *  // ⚡ if everything is 👌, here you can call server's methods. Note that when
 *  // the client isn't connected every execution of the `call` method will
 *  // throw an error.
 *                 🠗
 *     client.addEventListener('connect', () => {console.log('😃')});
 *     client.addEventListener('connectError', () => {console.error('😟')});
 *  // 💥 when the connection to the server breaks, an `close`event will be
 *  // raised
 *  // ⌛ and the client will try to connect to the server again
 *  // At this point you can check the connection status via `connect` or
 *  // `connectError` events.
 *  // And, as you can see, you can register client rpc-methods everywhere in
 *  // the code after calling the constructor. And this methods along with
 *  // the events will be connected to every new inner instance of the
 *  // Client class
 * ```
 *
 * This class can {@link ReconnectingClient.register|register} any method to call
 * it by the server.
 * And also can {@link ReconnectingClient.call|call} any method on the server and
 * receive response data.
 * And there are some events that can help you.
 *
 * The main parts of this class are:
 * - {@link ReconnectingClient.init|init} method to connect to the server
 * - {@link ReconnectingClient.close|close} event that triggers when connection
 * to the server is lost
 * - {@link ReconnectingClient.connect|connect} event that triggers when
 * the client successfully reconnects to the server
 * - {@link ReconnectingClient.connectError|connectError} event that triggers
 * when the server refuses the client to connect
 * - {@link ReconnectingClient.register|register} method to handle clients' calls
 * - {@link ReconnectingClient.call|call} method to execute clients' methods
 *
 * @example
 * ```typescript
 * import { ReconnectingClient } from '@noveo/dual-rpc-ws/client';
 * const client = new ReconnectingClient({
 *   token: 'id13',
 *   address: 'ws://192.168.0.80:8080'
 * });
 * try {
 *   await client.init();
 *   console.log('successfully connected for the first time!');
 *   client.register('hi', (params, context) => {
 *     console.log('client hi, call id:', context.id);
 *     return Promise.resolve(`${token}, hello`);
 *   });
 *   client.addEventListener('connect', () => {
 *     console.log('successfully reconnected!');
 *   });
 *   client.addEventListener('connectError', () => {
 *     console.error('server refuses to reconnect!');
 *   });
 *   client.addEventListener('close', () => {
 *     console.log('connection closed!');
 *   });
 *   try {
 *     const serverResponse = client.call('hi', {message: 'Server, hi!'});
 *     console.log('Hello from server', serverResponse);
 *   } catch(e) {
 *     console.error('Trouble with call', e.message);
 *   }
 * } catch(e) {
 *   console.error('server refuses to connect!')
 * }
 * ```
 */
export class ReconnectingClient {
  private instance?: Client;

  private readonly params: ClientOptions;

  private interval = 3000;

  private serverRejected = false;

  private connectedForTheFirstTime = false;

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

  /**
   * Creates the Client instance
   * @param params An object which passed out to define all the main properties
   * of the server. Notable fields are: {@link ClientOptions.address},
   * {@link ClientOptions.prepareContext}.
   */
  constructor(params: ClientOptions) {
    this.params = params;
  }

  /**
   * Establish tho connection to the server using an address and unique id that
   * specifies the client's constructor.
   * @throws {@link Errors.NotConnectedError} Exception is thrown when the server
   * refuses the client to connect.
   */
  async init(): Promise<ReconnectingClient> {
    this.connectedForTheFirstTime = false;
    return new Promise((resolve, reject) => {
      this.instance = new Client({
        ...this.params,
        handshake: (connected) => {
          if (connected) {
            this.connect(); // event
            resolve(this);
          } else {
            this.connectError(); // event
          }
        },
        errorHandler: (error) => {
          this.dispatchEvent(
            'error',
            new CustomEvent(error.name, { detail: error.message }),
          );
        },
      });
      this.instance.addEventListener('close', async (_event) => {
        this.removeAllListeners(false);
        try {
          await this.close();
          if (!this.connectedForTheFirstTime) {
            resolve(this);
          }
        } catch (e) {
          if (!this.connectedForTheFirstTime) {
            reject(e);
          }
        }
      });
    });
  }

  /**
   * Fires when the connection with the server closes
   * @event close
   */
  async close() {
    if (!this.serverRejected) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          this.init()
            .then(() => resolve(this))
            .catch(reject);
        }, this.interval);
      });
    } else {
      throw new Errors.NotConnectedError(`The server rejected the connection`);
    }
  }

  /**
   * Fires when the client successfully reconnects to the server
   * @event connect
   */
  connect() {
    this.connectedForTheFirstTime = true;
    this.attachMethodsAndListeners();
    this.dispatchEvent('connect', new CustomEvent('connect'));
  }

  /**
   * Fires when the server refuses the client to connect in the reconnection
   * attempt
   * @event reconnectError
   */
  connectError() {
    this.serverRejected = true;
    this.dispatchEvent('connectError', new CustomEvent('connectError'));
  }

  /**
   * Call the server method using params as one argument construction.
   * @return Returns a Promise with the JSON response from the client. It can be an
   * object, an array or a primitive.
   * @param method The name of the remote method to call
   * @param params Method arguments
   * @throws one of these errors:
   * - {@link Errors.ProcedureNotFoundError} When the method doesn't present on
   * the server side
   * - {@link Errors.RequestError} When the method call on the server
   * triggered an exception
   * - {@link Errors.NotConnectedError} When the socket isn't connected to the
   * server
   */
  call(
    method: string,
    params?: Record<string, any>,
  ): Promise<object | [] | string | number | boolean | null> {
    if (this.instance) {
      return this.instance.call(method, params);
    } else {
      throw new Errors.NotConnectedError();
    }
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
    totallyRemove = true,
  ): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners && totallyRemove) {
      typeListeners.delete(listener);
    }
    if (this.instance) {
      this.instance.removeEventListener(type, listener);
    }
  }

  /**
   * Additional method to remove all listeners. See
   * https://html.spec.whatwg.org/multipage/web-sockets.html#garbage-collection-2
   * @param totallyRemove Remove them only from the websocket instance
   */
  removeAllListeners(totallyRemove = true) {
    for (const [type, listeners] of this.listeners) {
      for (const listener of listeners.keys()) {
        this.removeEventListener(type, listener, totallyRemove);
      }
    }
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
  disconnect() {
    this.instance?.close();
  }
}
