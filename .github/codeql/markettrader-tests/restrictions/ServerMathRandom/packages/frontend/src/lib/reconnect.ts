// OK: reconnect jitter in the browser is not security-sensitive.
export class ReconnectController {
  private readonly random: () => number;
  constructor(options: { random?: () => number } = {}) {
    this.random = options.random ?? Math.random;
  }
  jitter(): number {
    return this.random() * Math.random();
  }
}
