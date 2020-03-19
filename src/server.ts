import WebSocket, { ServerOptions as WSServerOptions } from 'ws';
import { v4 } from 'uuid';

type id = string;
type name = string;

interface ServerOptions extends WSServerOptions {
  handshake?: (token: id) => Promise<boolean>;
}

interface RPCMessage {
  jsonrpc: string;
  method: string;
  params: Record<string, any>;
  id: string;
  result: any;
}

interface DeviceSocket extends WebSocket {
  token: id;
}

class Request {
  private server: Server;
  private timer: number;
  resolve: Function;
  reject: Function;
  private id: string;

  constructor({
    server,
    timeout,
    resolve,
    reject,
    id,
  }: {
    server: Server;
    timeout: number;
    resolve: Function;
    reject: Function;
    id: string;
  }) {
    this.server = server;
    this.timer = (setTimeout(
      this.destructor.bind(this),
      timeout,
    ) as any) as number;
    this.resolve = resolve;
    this.reject = reject;
    this.id = id;
  }

  destructor() {
    this.server.requests.delete(this.id);
    this.reject();
  }
}

export default class Server extends WebSocket.Server {
  private devices: Map<id, WebSocket>;

  private methods: Map<name, Function>;

  requests: Map<id, Request>;

  private handshake: ((token: id) => Promise<boolean>) | undefined;

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
                result = await this.handshake(message.params.id);
              }
              ws.send(
                JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'connect',
                  params: {
                    result,
                  },
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
          server: this,
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
