import WebSocket, { ServerOptions as WSServerOptions } from 'ws';
import { v4 } from 'uuid';
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

/**
 * Current dual-ws-rpc server statistics
 */
export interface ServerStats {
  /**
   * An array of all connected tokens
   */
  connections: Id[];
  /**
   * Number of processing remote procedures calls
   */
  requestsInProgress: number;
  /**
   * Number of processing calls from clients
   */
  responseInProgress: number;
}

export interface ServerOptions extends WSServerOptions {
  /**
   * An asynchronous function which handles every new connection.
   * It accepts two arguments, token and ws.
   * Function must return `true` value if we want to establish the connection.
   * And the connection will be dropped otherwise.
   * @param token  Unique token of the client
   * @param ws  A websocket instance of the connection
   * @example
   * ```typescript
   * handshake: async (token) => {
   *   console.log('trying to connect', token);
   *   if (await theUserExistsInTheDatabase(token)) {
   *     return true;
   *   } else {
   *     return false
   *   }
   * }
   * ```
   */
  handshake?: (token: Id, ws: ClientSocket) => Promise<boolean> | boolean;
  /**
   * Optional function to define initial context for the {@link Server.register}
   * handlers. By default it returns the {@link RPCContext} object
   * @param ctx An object with the `token` and `id` properties. Where `id` - is
   * a unique method call identifier
   * @example
   * ```typescript
   * const server = new Server({
   *   ...
   *   prepareContext: (ctx) => ({ ...ctx, useWS: true }),
   * });
   * server.register('ping', (ctx, params) => {
   *   console.log(ctx.id, 'server ping from', ctx.token, params, ctx.useWS);
   * });
   * ```
   */
  prepareContext?: (ctx: RPCContext) => any;
}

export interface ClientSocket extends WebSocket {
  /**
   * Unique token id of the client
   */
  token: Id;
}

/**
 * Websocket server class which accepts the connection from the clients,
 * checks their tokens. It can {@link Server.register|register} any method
 * to call it by the client.
 * And also can {@link Server.call|call} any method on the client by its token
 * and receive response data.
 *
 * The main parts of this class are:
 * - {@link ServerOptions.handshake|handshake} handler for the constructor
 * - {@link ServerOptions.prepareContext|prepareContext} function for the constructor
 * - {@link Server.register|register} method to handle clients' calls
 * - {@link Server.call|call} method to execute clients' methods
 * - {@link Server.rpcClose|rpcClose} event for all disconnected clients
 *
 * @example
 * ```typescript
 * import Server from '@noveo/dual-rpc-ws';
 *
 * const server = new Server({
 *   port: 8081,
 *   handshake: async (token) => {
 *     console.log('connected', token);
 *     this.call(token, 'hi', {message: 'hello from server'});
 *     return Promise.resolve(true);
 *   },
 * });
 *
 * server.register('hi', (token, params) => {
 *   console.log('server hi', params);
 *   return Promise.resolve(`${token}, hello`);
 * });
 * ```
 */
export default class Server extends WebSocket.Server {
  private devices: Map<Id, WebSocket>;

  private methods: Map<
    Name,
    (
      ctx: RPCContext,
      params: Record<string, any>,
    ) => Promise<JSONValue> | JSONValue | undefined
  >;

  private requests: Map<Id, Request>;

  private readonly handshake: (
    token: Id,
    ws: ClientSocket,
  ) => Promise<boolean> | boolean = (_) => Promise.resolve(true);

  private readonly prepareContext: (ctx: RPCContext) => any = (ctx) => ctx;

  private responseInProgress: number = 0;

  /**
   * Setup the server with ws.ServerOptions object.
   *
   * {@link ServerOptions.handshake} is the handler for the new connections.
   * It accepts client token, {@link ClientSocket} instance
   * of the new connection and returns `true`
   * if the connection can be established and `false` to broke the connection.
   * If you don't pass the `handshake` property, server will accept every client.
   * @param params An object which passed out to define all the main properties
   * of the server. Notable fields are: {@link ServerOptions.port},
   * {@link ServerOptions.handshake} and {@link ServerOptions.prepareContext}.
   */
  constructor(params: ServerOptions) {
    super(params);
    this.devices = new Map();
    this.methods = new Map();
    this.requests = new Map();
    if (params.handshake) {
      this.handshake = params.handshake;
    }
    if (params.prepareContext) {
      this.prepareContext = params.prepareContext;
    }
    this.on('connection', (ws: ClientSocket) => {
      // Event on removing the client
      ws.on('close', () => {
        this.devices.delete(ws.token);
        this.rpcClose(ws.token);
      });
      // Message processing
      ws.on('message', async (data: string) => {
        const message = getMessage(data);
        switch (message.type) {
          case MessageType.Malformed:
            this.error(
              new Errors.InvalidJSONRPCError(`Malformed message: ${data}`),
            );
            // throw new Errors.InvalidJSONRPCError(`Malformed message: ${data}`);
            break;
          case MessageType.Connect:
            if (!message.params.id) {
              return this.error(
                new Errors.InvalidJSONRPCError(
                  `No connection id presents in ${message.id}`,
                ),
              );
              // throw new Errors.InvalidJSONRPCError(
              //   `No connection id presents in ${message.id}`,
              // );
            }
            this.devices.set(message.params.id, ws);
            ws.token = message.params.id;
            try {
              let result = await this.handshake(message.params.id, ws);
              ws.send(
                RPCHelpers.rpcRequest(
                  'connect',
                  { result, message: 'Server rejected the connection' },
                  message.id,
                ),
              );
              if (!result) {
                ws.close();
              }
            } catch (e) {
              ws.send(
                RPCHelpers.rpcRequest(
                  'connect',
                  { result: false, message: e.message },
                  message.id,
                ),
              );
            }
            break;
          case MessageType.Request:
            const method = this.methods.get(message.method);
            if (!method) {
              return ws.send(
                RPCHelpers.rpcError(`Procedure not found.`, message.id),
              );
            }
            try {
              this.responseInProgress += 1;
              const result = await method.call(
                this,
                this.prepareContext({
                  id: message.id,
                  token: ws.token,
                }),
                message.params,
              );
              ws.send(RPCHelpers.rpcResponse(result, message.id));
            } catch (error) {
              ws.send(RPCHelpers.rpcError(error.message, message.id));
            } finally {
              this.responseInProgress -= 1;
            }
            break;
          case MessageType.Response:
          case MessageType.Error:
            const request = this.requests.get(message.id);
            if (!request) {
              return this.error(
                new Errors.RequestError(`Wrong request id: ${message.id}`),
              );
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
    });
  }

  /**
   * Fires when the connection with the client closed
   * @param token The unique token of the client from the
   * {@link Server.handshake} handler
   * @event rpcClose
   * @example
   * ```typescript
   * server.on('rpcClose', (token) => console.log(`Client disconnected ${token}`));
   * ```
   */
  rpcClose(token: Id) {
    this.emit('rpcClose', token);
  }

  /**
   * Fires when the error happens
   * @param error Error instance from {@link Errors} or {@link WebSocket} class
   * @event error
   * @example
   * ```typescript
   * server.on('error', (e) => {
   *   if (e instanceof Errors.InvalidJSONRPCError) {
   *     console.error('Wrong data from client');
   *   } else {
   *     console.error('Error', e);
   *   }
   * });
   * ```
   */
  error(error: Error) {
    this.emit('error', error);
  }

  /**
   * Call the client's method by the token and method name using params as one
   * argument construction.
   *
   * @return Returns a Promise with the JSON response from the client. It can be an
   * object, an array or a primitive.
   * @param token Unique token of the client
   * @param method The name of the remote method to call
   * @param params Method arguments
   * @throws one of these errors:
   * - {@link Errors.NotConnectedError} When the client with token isn't connected
   * - {@link Errors.ProcedureNotFoundError} When the method doesn't present on
   * the client side
   * - {@link Errors.RequestError} When the method call on the client side
   * triggered an exception
   */
  call(
    token: Id,
    method: Name,
    params?: Record<string, any>,
  ): Promise<JSONValue> {
    const device = this.devices.get(token);
    if (!device) {
      throw new Errors.NotConnectedError(
        `Client with token: ${token} doesn't connected`,
      );
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
      device.send(RPCHelpers.rpcRequest(method, params ?? null, id));
    });
  }

  /**
   * Register the method on the server side, handler accepts token of the client
   * it was called and params as an object and must return an `object` or a
   * `Promise<object>` which will be held on the client side.
   *
   * First argument of the handler is the context object, which contains by the
   * default token and unique message id of the rpc call
   * @example
   * ```typescript
   * rpc.register('ping', (ctx, params) => {
   *   console.log(ctx.id, 'server ping from', ctx.token, params);
   *   return Promise.resolve({ server: 'pong' });
   * });
   * ```
   *
   * You can throw an exception in the handler and on the caller side the client
   * will catch the rejection of the calling promise.
   * @example
   * ```typescript
   * rpc.register('exception', () => {
   *   throw new Error('server exception');
   * });
   *
   * // client
   * ws.call('exception', {})
   *   .catch((e) => console.log(e.message)); // prints "server exception"
   * ```
   *
   * If the function does not return a value, a value of `null` will be obtained
   * on the client side. Because there is no `undefined` value in the JSON
   * representation.
   *
   * @param method Method name
   * @param handler Handler with context and params arguments
   */
  register(
    method: string,
    handler: (
      ctx: RPCContext,
      params: Record<string, any>,
    ) => Promise<JSONValue> | JSONValue | undefined,
  ) {
    this.methods.set(method, handler);
  }

  /**
   * Unregister the method on the server side
   * @param method
   */
  unregister(method: Name): void {
    this.methods.delete(method);
  }

  get stats(): ServerStats {
    return {
      connections: [...this.devices.keys()],
      requestsInProgress: this.requests.size,
      responseInProgress: this.responseInProgress,
    };
  }
}
