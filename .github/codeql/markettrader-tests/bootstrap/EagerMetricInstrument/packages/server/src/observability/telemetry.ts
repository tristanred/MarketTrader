import { metrics } from '@opentelemetry/api';

// OK: built lazily on first property access.
function buildInstruments() {
  const meter = metrics.getMeter('markettrader');
  return {
    trades: meter.createCounter('markettrader.trades'),
    duration: meter.createHistogram('markettrader.duration'),
  };
}

type Instruments = ReturnType<typeof buildInstruments>;
let instruments: Instruments | undefined;

export const meters: Instruments = new Proxy({} as Instruments, {
  get: (_t, key) => (instruments ??= buildInstruments())[key as keyof Instruments],
});
