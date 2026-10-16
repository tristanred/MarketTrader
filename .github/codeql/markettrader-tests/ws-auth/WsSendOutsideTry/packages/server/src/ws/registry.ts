export class Registry {
  private readonly clients = new Map<any, unknown>();
  private readonly ws: any;

  broadcast(payload: string): void {
    for (const [socket] of this.clients) {
      if (socket.readyState === 1) {
        try { socket.send(payload); } catch { /* closed between check and send */ } // GOOD
      }
    }
  }

  sendRaw(socket: any, payload: string): void {
    if (socket.readyState === 1) socket.send(payload); // flagged
  }

  sendViaField(payload: string): void {
    this.ws.send(payload); // flagged
  }

  sendInCatch(socket: any, payload: string): void {
    try {
      socket.ping();
    } catch {
      socket.send(payload); // flagged: a catch block is not protected
    }
  }

  sendInClosure(socket: any, payload: string): void {
    try {
      // flagged: the try belongs to the outer function, not the callback that runs later.
      setTimeout(() => socket.send(payload), 10);
    } catch {
      // ignore
    }
  }
}
