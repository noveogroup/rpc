import { v4 } from 'react-native-uuid';
import {
  getMessageAndType,
  id,
  MessageType,
  name,
  Request,
  rpcError,
  rpcRequest,
  rpcResponse,
} from './common';

export default class Client extends WebSocket {
  private methods: Map<name, Function>;

  private requests: Map<id, Request>;

  handshake: (connected: boolean) => void;

  constructor(token: id, address: string, protocols?: string | string[]) {
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
            this.send(rpcError(error, message.id));
          }
          break;
        case MessageType.Response:
        case MessageType.Error:
          const request = this.requests.get(message.id);
          if (!request) {
            throw new Error(`Wrong request id: ${message.id}`);
          }
          if (message.result) {
            request.resolve(message.result);
          } else if (message.error) {
            request.reject(message.error);
          }
          this.requests.delete(message.id);
          break;
      }

      // request
      if (message.method) {
      } else {
        // response
      }
    });
  }

  async call(method: string, params: object): Promise<object> {
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
      this.send(rpcRequest(method, params, id));
    });
  }

  register(method: string, handler: Function) {
    this.methods.set(method, handler);
  }
}
