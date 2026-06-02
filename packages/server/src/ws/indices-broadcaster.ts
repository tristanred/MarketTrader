import type { StockProvider } from '../providers/index.js';
import type { SystemSettingsService } from '../services/system-settings.js';
import type { GlobalClientRegistry } from './global-registry.js';
import type { IndexQuote, LiveWsMessage } from '@markettrader/shared';

const MAJOR_INDICES = ['^GSPC', '^IXIC', '^DJI'] as const;

export interface IndicesBroadcasterOptions {
  intervalMs?: number;
}

/**
 * Polls the active {@link StockProvider} for major indices and the
 * configured ticker-tape symbols, then broadcasts the batched results to
 * every connected `/ws/live` client. Runs independently of game state.
 *
 * Re-reads the symbol list when {@link SystemSettingsService} emits a
 * `'change'` event, so admin edits propagate without a restart.
 */
export class IndicesBroadcaster {
  private symbols: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly onSettingsChange = (newSymbols: string[]) => {
    this.symbols = mergeSymbols(MAJOR_INDICES, newSymbols);
  };

  constructor(
    private readonly provider: StockProvider,
    private readonly settings: SystemSettingsService,
    private readonly registry: GlobalClientRegistry,
    options: IndicesBroadcasterOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 5000;
  }

  async start(): Promise<void> {
    const tape = await this.settings.getTickerTapeSymbols();
    const tapeSymbols = tape?.symbols ?? [];
    this.symbols = mergeSymbols(MAJOR_INDICES, tapeSymbols);
    this.settings.on('change', this.onSettingsChange);
    this.timer = setInterval(() => {
      // Mirror the price-poller: swallow per-tick errors so a single failed
      // tick can't become an unhandled rejection that crashes the process if
      // tick() ever grows a throwing path before its internal try/catch.
      void this.tick().catch(() => {});
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.settings.off('change', this.onSettingsChange);
  }

  private async tick(): Promise<void> {
    const quotes: IndexQuote[] = [];
    let indexFailures = 0;
    await Promise.all(
      this.symbols.map(async (symbol) => {
        try {
          const q = await this.provider.getQuote(symbol);
          quotes.push({
            symbol,
            last: q.price,
            changeAbs: q.change,
            changePct: q.changePercent,
          });
        } catch {
          if ((MAJOR_INDICES as readonly string[]).includes(symbol)) {
            indexFailures += 1;
          }
        }
      }),
    );

    const unavailable = indexFailures === MAJOR_INDICES.length;
    const message: LiveWsMessage = {
      event: 'indices',
      data: {
        quotes,
        at: new Date().toISOString(),
        ...(unavailable ? { unavailable: true } : {}),
      },
    };
    this.registry.broadcast(message);
  }
}

function mergeSymbols(...lists: ReadonlyArray<readonly string[]>): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const s of list) {
      if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}
