import WebSocket, { ServerOptions as WSServerOptions } from 'ws';
import { v4 } from 'uuid';
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

export interface ServerOptions extends WSServerOptions {
  handshake?: (token: id, ws: DeviceSocket) => Promise<boolean>;
}

export interface DeviceSocket extends WebSocket {
  token: id;
}

export default class Server extends WebSocket.Server {
  private devices: Map<id, WebSocket>;

  private methods: Map<name, Function>;

  private requests: Map<id, Request>;

  private readonly handshake:
    | ((token: id, ws: DeviceSocket) => Promise<boolean>)
    | undefined;

  constructor(params: ServerOptions) {
    super(params);
    this.devices = new Map();
    this.methods = new Map();
    this.requests = new Map();
    this.handshake = params.handshake;

    this.on('connection', (ws: DeviceSocket) => {
      // Event on removing the client
      ws.on('close', () => {
        this.devices.delete(ws.token);
        this.emit('rpcClose', ws.token);
      });
      // Message processing
      ws.on('message', async (data: string) => {
        const [type, message] = getMessageAndType(data);
        if (!message || type === MessageType.Malformed) {
          throw new Error(`Malformed message: ${data}`);
        }
        switch (type) {
          case MessageType.Connect:
            if (!message.params.id) {
              throw new Error(`No connection id presents in ${message.id}`);
            }
            this.devices.set(message.params.id, ws);
            ws.token = message.params.id;
            let result = true;
            if (this.handshake) {
              result = await this.handshake(message.params.id, ws);
            }
            ws.send(rpcRequest('connect', { result }, message.id));
            if (!result) {
              ws.close();
            }
            break;
          case MessageType.Request:
            const method = this.methods.get(message.method);
            if (!method) {
              return ws.send(rpcError(`Procedure not found.`, message.id));
            }
            try {
              const result = await method.call(this, message.params);
              ws.send(rpcResponse(result, message.id));
            } catch (error) {
              ws.send(rpcError(error.message, message.id));
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
      });
    });
  }

  async call(token: string, method: string, params: object): Promise<object> {
    const device = this.devices.get(token);
    if (!device) {
      throw new Error(`Device with token: ${token} doesn't connected`);
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
      device.send(rpcRequest(method, params, id));
    });
  }

  register(method: string, handler: (params: any) => Promise<any> | any) {
    this.methods.set(method, handler);
  }
}
