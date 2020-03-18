type id = string;
type name = string;

interface RPCMessage {
  jsonrpc: string;
  method: string;
  params: Record<string, any>;
  id: string;
  result: any;
}

class Request {
  private client: Client;
  private timer: number;
  resolve: Function;
  reject: Function;
  private id: string;

  constructor({
    client,
    timeout,
    resolve,
    reject,
    id,
  }: {
    client: Client;
    timeout: number;
    resolve: Function;
    reject: Function;
    id: string;
  }) {
    this.client = client;
    this.timer = (setTimeout(
      this.destructor.bind(this),
      timeout,
    ) as any) as number;
    this.resolve = resolve;
    this.reject = reject;
    this.id = id;
  }

  destructor() {
    this.client.requests.delete(this.id);
    this.reject();
  }
}

// @ts-ignore
export default class Client extends WebSocket {
  private methods: Map<name, Function>;

  requests: Map<id, Request>;

  constructor(cid: id, address: string, protocols?: string | string[]) {
    super(address, protocols);

    this.methods = new Map();
    this.requests = new Map();

    this.addEventListener('open', () => {
      this.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'connect',
          params: {
            id: cid,
          },
        }),
      );
    });

    this.addEventListener('message', async (string: any) => {
      const message: RPCMessage = JSON.parse(string.data.toString());
      // request
      if (message.method) {
        if (message.method === 'connect') {
          this.dispatchEvent(new Event('handshake'));
          return;
        }
        try {
          // @ts-ignore
          const result = await this.methods
            .get(message.method)
            .call(this, message.params);
          this.send(
            JSON.stringify({
              jsonrpc: '2.0',
              result,
              id: message.id,
            }),
          );
        } catch (error) {
          this.send(
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
          throw new Error('');
        }
        // @ts-ignore
        this.requests.get(message.id).resolve(message.result);
      }
    });
  }

  async call(method: string, params: object): Promise<object> {
    const id = Date.now().toString();
    this.send(
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
          client: this,
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
