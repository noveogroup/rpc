import WebSocket, { ServerOptions } from 'ws';
import { v4 } from 'uuid';

type id = string;
type name = string;

interface RPCMessage {
  jsonrpc: string;
  method: string;
  params: Record<string, any>;
  id: string;
  result: any;
}

interface DeviceSocket extends WebSocket {
  deviceId: id;
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

  constructor(params: ServerOptions) {
    super(params);
    this.devices = new Map();
    this.methods = new Map();
    this.requests = new Map();

    this.on('connection', (ws: DeviceSocket) => {
      // Event on removing the client
      ws.on('close', () => {
        this.devices.delete(ws.deviceId);
      });
      // Message processing
      ws.on('message', async (string: string) => {
        const message: RPCMessage = JSON.parse(string);
        switch (message.method) {
          case 'connect':
            {
              this.devices.set(message.params.id, ws);
              ws.deviceId = message.params.id;
              if (this.listenerCount('handshake') === 1) {
                this.emit('handshake', message.params.id, (result: boolean) => {
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
                });
              } else {
                ws.send(
                  JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'connect',
                    params: {
                      result: true,
                    },
                  }),
                );
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
                  .call(this, message.params);
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

  async call(
    clientId: string,
    method: string,
    params: object,
  ): Promise<object> {
    const id = v4();
    if (!this.devices.has(clientId)) {
      throw new Error(`Device with id: ${clientId} doesn't connected`);
    }
    // @ts-ignore
    this.devices.get(clientId).send(
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
