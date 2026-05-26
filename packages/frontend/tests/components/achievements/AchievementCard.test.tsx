import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AchievementCard } from '@/components/achievements/AchievementCard';
import type { AchievementDefinitionDTO, AchievementProgressDTO } from '@markettrader/shared';

const def: AchievementDefinitionDTO = {
  key: 'first-trade',
  name: 'First Trade',
  description: 'Execute your first trade.',
  rarity: 'common',
  icon: 'circle-dot',
  target: 1,
  enabled: true,
};

describe('AchievementCard', () => {
  it('renders name, description, and rarity tier label', () => {
    render(<AchievementCard definition={def} progress={null} />);
    expect(screen.getByText('First Trade')).toBeInTheDocument();
    expect(screen.getByText('Execute your first trade.')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('applies the rarity class for the given rarity', () => {
    const progress: AchievementProgressDTO = {
      achievementKey: 'first-trade',
      gamePlayerId: 'gp1',
      progress: 1,
      target: 1,
      unlockedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const { container } = render(<AchievementCard definition={{ ...def, rarity: 'legendary' }} progress={progress} />);
    expect(container.firstChild).toHaveClass('rar-legendary');
  });

  it('renders LOCKED tier label and muted styling when progress is null/zero', () => {
    const { container } = render(<AchievementCard definition={def} progress={null} />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(container.firstChild).not.toHaveClass('rar-common');
  });

  it('renders progress count for in-progress achievements', () => {
    const progress: AchievementProgressDTO = {
      achievementKey: 'first-trade',
      gamePlayerId: 'gp1',
      progress: 4,
      target: 10,
      unlockedAt: null,
    };
    render(<AchievementCard definition={{ ...def, target: 10 }} progress={progress} />);
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
    expect(screen.getByText('In progress · Common')).toBeInTheDocument();
  });

  it('renders "unlocked · {time}" for unlocked achievements', () => {
    const progress: AchievementProgressDTO = {
      achievementKey: 'first-trade',
      gamePlayerId: 'gp1',
      progress: 1,
      target: 1,
      unlockedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    render(<AchievementCard definition={def} progress={progress} />);
    expect(screen.getByText(/unlocked/i)).toBeInTheDocument();
  });
});
