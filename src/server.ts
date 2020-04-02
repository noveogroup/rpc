import WebSocket, { ServerOptions as WSServerOptions } from 'ws';
import { v4 } from 'uuid';
import { id, name, Request, RPCMessage } from './common';

export interface ServerOptions extends WSServerOptions {
  handshake?: (token: id, ws: DeviceSocket) => Promise<boolean>;
}

export interface DeviceSocket extends WebSocket {
  token: id;
}

export default class Server extends WebSocket.Server {
  private devices: Map<id, WebSocket>;

  private methods: Map<name, Function>;

  requests: Map<id, Request>;

  private readonly handshake: ((token: id, ws: DeviceSocket) => Promise<boolean>) | undefined;

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
      ws.on('message', async (string: string) => {
        const message: RPCMessage = JSON.parse(string);
        switch (message.method) {
          case 'connect':
            {
              this.devices.set(message.params.id, ws);
              ws.token = message.params.id;
              let result = true;
              if (this.handshake) {
                result = await this.handshake(message.params.id, ws);
              }
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'connect',
                  params: {
                    result,
                  },
                  id: message.id
                }),
              );
              if (!result) {
                ws.close();
              }
            }
            break;
          default: {
            // request
            if (message.method) {
              try {
                // @ts-ignore
                const result = await this.methods
                  .get(message.method)
                  .call(this, ws.token, message.params);
                ws.send(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    result,
                    id: message.id,
                  }),
                );
              } catch (error) {
                ws.send(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    error,
                    id: message.id,
                  }),
                );
              }
            } else {
              // response
              if (!this.requests.has(message.id)) {
                throw new Error(`Wrong request id: ${message.id}`);
              }
              // @ts-ignore
              this.requests.get(message.id).resolve(message.result);
            }
          }
        }
      });
    });
  }

  async call(token: string, method: string, params: object): Promise<object> {
    const id = v4();
    if (!this.devices.has(token)) {
      throw new Error(`Device with token: ${token} doesn't connected`);
    }
    // @ts-ignore
    this.devices.get(token).send(
      JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id,
      }),
    );
    return new Promise((resolve, reject) => {
      this.requests.set(
        id,
        new Request({
          timeout: 5000,
          sender: this,
          resolve,
          reject,
          id,
        }),
      );
    });
  }

  register(method: string, handler: Function) {
    this.methods.set(method, handler);
  }
}
