import { liveBootConfig } from '../env.js';
import type { LiveConfigValues, LiveKey } from './registry.js';

/** Read-only view of a {@link RuntimeConfig}: what every consumer of a live option takes. */
export type ConfigReader = Pick<RuntimeConfig, 'get'>;

/**
 * Effective values of the live options for one app instance: an admin override
 * when one is active, otherwise the boot value. Built once per `buildApp` and
 * passed to consumers as a {@link ConfigReader}; only `ConfigOverridesService` writes.
 */
export class RuntimeConfig {
  private readonly boot: LiveConfigValues;
  private readonly current: LiveConfigValues;
  private readonly overridden = new Set<LiveKey>();

  constructor(boot: LiveConfigValues) {
    this.boot = { ...boot };
    this.current = { ...boot };
  }

  /**
   * A config whose boot values come from the process environment. `assume`
   * replaces individual boot values — tests use it to simulate a host that set
   * those variables, which is different from an admin override.
   */
  static fromEnvironment(assume: Partial<LiveConfigValues> = {}): RuntimeConfig {
    return new RuntimeConfig({ ...liveBootConfig, ...assume });
  }

  get<K extends LiveKey>(key: K): LiveConfigValues[K] {
    return this.current[key];
  }

  /** The value the process booted with, ignoring any override. */
  bootValue<K extends LiveKey>(key: K): LiveConfigValues[K] {
    return this.boot[key];
  }

  set<K extends LiveKey>(key: K, value: LiveConfigValues[K]): void {
    this.current[key] = value;
    this.overridden.add(key);
  }

  clear<K extends LiveKey>(key: K): void {
    this.current[key] = this.boot[key];
    this.overridden.delete(key);
  }

  clearAll(): void {
    for (const key of [...this.overridden]) this.clear(key);
  }

  overriddenKeys(): LiveKey[] {
    return [...this.overridden];
  }
}
