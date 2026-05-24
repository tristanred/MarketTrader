import { Award, type LucideIcon } from 'lucide-react';
import * as Icons from 'lucide-react';

/**
 * Resolves a Lucide kebab-case icon name (e.g. 'trending-up') to a Lucide
 * React component. Falls back to {@link Award} for unknown names and logs
 * once per missing name per session so authoring typos surface in devtools.
 */
const warned = new Set<string>();

export function getAchievementIcon(name: string): LucideIcon {
  const pascal = name
    .split('-')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
  const candidate = (Icons as unknown as Record<string, LucideIcon | undefined>)[pascal];
  if (candidate) return candidate;
  if (!warned.has(name)) {
    warned.add(name);
    // eslint-disable-next-line no-console
    console.warn(`[achievements] Unknown Lucide icon "${name}" — falling back to Award.`);
  }
  return Award;
}
