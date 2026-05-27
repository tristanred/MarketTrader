import { useSearchParams } from 'react-router-dom';
import { AchievementToastPreview } from '@/components/achievements/AchievementToastPreview';
import type { AchievementRarity } from '@markettrader/shared';

const VALID_RARITIES: ReadonlySet<AchievementRarity> = new Set([
  'common', 'uncommon', 'rare', 'epic', 'legendary',
]);

function parseRarity(raw: string | null): AchievementRarity {
  if (raw && VALID_RARITIES.has(raw as AchievementRarity)) {
    return raw as AchievementRarity;
  }
  return 'common';
}

/**
 * Visual sandbox for one achievement toast. Reads name/description/rarity/icon
 * from query params and renders a single, static toast on a transparent
 * background. Used by `scripts/generate-achievement-docs.mts` (Playwright +
 * prefers-reduced-motion) to capture per-achievement preview PNGs.
 *
 * Example: /__toast-preview?name=Ten-Bagger&description=Close+a+single+position+with+at+least+a+10x+return.&rarity=legendary&icon=gem
 */
export function AchievementToastPreviewPage() {
  const [params] = useSearchParams();
  const name = params.get('name') ?? 'Achievement';
  const description = params.get('description') ?? '';
  const rarity = parseRarity(params.get('rarity'));
  const icon = params.get('icon') ?? 'circle-dot';

  return (
    <div className="flex min-h-screen items-center justify-center p-6" data-testid="toast-preview-root">
      <AchievementToastPreview
        name={name}
        description={description}
        rarity={rarity}
        icon={icon}
      />
    </div>
  );
}
