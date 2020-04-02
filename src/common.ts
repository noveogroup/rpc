export type id = string;
export type name = string;

export interface RPCMessage {
  jsonrpc: string;
  method: string;
  params: Record<string, any>;
  id: string;
  result: any;
}

interface RequestSender {
  requests: Map<id, Request>;
}

export class Request {
  private sender: RequestSender;
  private timer: number;
  resolve: Function;
  reject: Function;
  private readonly id: string;

  constructor({
                sender,
                timeout = 5000,
                resolve,
                reject,
                id,
              }: {
    sender: RequestSender;
    timeout: number;
    resolve: Function;
    reject: Function;
    id: string;
  }) {
    this.sender = sender;
    this.timer = (setTimeout(
      this.destructor.bind(this),
      timeout,
    ) as any) as number;
    this.resolve = resolve;
    this.reject = reject;
    this.id = id;
  }

  destructor() {
    this.sender.requests.delete(this.id);
    this.reject();
  }
}
