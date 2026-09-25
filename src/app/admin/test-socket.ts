// A stand-in for the browser's WebSocket in the dashboard's and the presence
// client's tests: records what was opened and sent, and lets the test open,
// answer and drop each socket by hand.

export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: ((event: object) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static get last(): FakeSocket | undefined {
    return FakeSocket.instances.at(-1);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(code = 1000): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.closedWith = code;
    this.drop(code);
  }

  /** The server accepted the connection. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.({});
  }

  receive(data: unknown): void {
    this.onmessage?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }

  /** The connection ended (refused, lost, or closed by the server). */
  drop(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

let visibility: DocumentVisibilityState = "visible";

/** Shows or hides the page, as switching tabs does. */
export function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}
