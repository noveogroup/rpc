import { v4 } from 'react-native-uuid';
import {
  getMessageAndType,
  Id,
  JSONValue,
  MessageType,
  Name,
  Request,
  RPCContext,
  rpcError,
  rpcRequest,
  rpcResponse,
} from './common';

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
 * const client = new Client('id13', 'ws://192.168.0.80:8080');
 * client.handshake = (connected) => {
 *   console.log('connected', connected);
 *   this.call(token, 'hi', {message: 'hello from client'});
 * };
 * client.register('hi', (token, params) => {
 *   console.log('client hi', params);
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
    ) => Promise<JSONValue> | JSONValue
  >;

  private requests: Map<Id, Request>;

  handshake: (connected: boolean) => void;

  private readonly prepareContext: (ctx: RPCContext) => any = (ctx) => ctx;

  /**
   * Connect to the server using an address and unique id that specifies the client
   * @param params An object which passed out to define all the main properties
   * of the server. Notable fields are: {@link ClientOptions.address},
   * {@link ClientOptions.handshake} and {@link ClientOptions.prepareContext}.
   */
  constructor(params: ClientOptions) {
    super(params.address, params.protocols);

    this.methods = new Map();
    this.requests = new Map();
    this.handshake = () => {};
    if (params.handshake) {
      this.handshake = params.handshake;
    }
    if (params.prepareContext) {
      this.prepareContext = params.prepareContext;
    }

    this.addEventListener('open', () => {
      this.send(rpcRequest('connect', { id: params.token }, v4()));
    });

    this.addEventListener('message', async (event) => {
      const [type, message] = getMessageAndType(event.data);
      if (!message || type === MessageType.Malformed) {
        throw new Error(`Malformed message: ${event.data}`);
      }
      switch (type) {
        case MessageType.Connect:
          this.handshake(message.params.result);
          break;
        case MessageType.Request:
          const method = this.methods.get(message.method);
          if (!method) {
            return this.send(rpcError(`Procedure not found.`, message.id));
          }
          try {
            const result = await method.call(
              this,
              message.params,
              this.prepareContext({ id: message.id }),
            );
            this.send(rpcResponse(result, message.id));
          } catch (error) {
            this.send(rpcError(error.message, message.id));
          }
          break;
        case MessageType.Response:
        case MessageType.Error:
          const request = this.requests.get(message.id);
          if (!request) {
            throw new Error(`Wrong request id: ${message.id}`);
          }
          if (typeof message.result !== undefined) {
            request.resolve(message.result);
          } else if (typeof message.error !== undefined) {
            request.reject(new Error(message.error));
          }
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
      this.send(rpcRequest(method, params ?? null, id));
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
    method: string,
    handler: (
      params: Record<string, any>,
      ctx: RPCContext,
    ) => Promise<JSONValue> | JSONValue,
  ) {
    this.methods.set(method, handler);
  }
}
