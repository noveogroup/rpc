import { v4 } from 'react-native-uuid';
import {
  getMessageAndType,
  Id,
  MessageType,
  Name,
  Request,
  rpcError,
  rpcRequest,
  rpcResponse,
} from './common';

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
  private methods: Map<Name, Function>;

  private requests: Map<Id, Request>;

  handshake: (connected: boolean) => void;

  /**
   * Connect to the server using an address and unique id that concretize the client
   * @param token Unique id of the client
   * @param address Server's address ex. `wss://192.168.1.1/ws`
   * @param protocols
   */
  constructor(token: Id, address: string, protocols?: string | string[]) {
    super(address, protocols);

    this.methods = new Map();
    this.requests = new Map();
    this.handshake = () => {};

    this.addEventListener('open', () => {
      this.send(rpcRequest('connect', { id: token }, v4()));
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
            const result = await method.call(this, message.params);
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
   * @param method
   * @param handler
   */
  register(method: string, handler: Function) {
    this.methods.set(method, handler);
  }
}
