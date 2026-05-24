import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AchievementRoster } from '@/components/achievements/AchievementRoster';
import type { AchievementDefinitionDTO, AchievementProgressDTO } from '@markettrader/shared';

const defs: AchievementDefinitionDTO[] = [
  { key: 'a', name: 'A', description: '', rarity: 'common',    icon: 'x', target: 1, enabled: true },
  { key: 'b', name: 'B', description: '', rarity: 'legendary', icon: 'x', target: 1, enabled: true },
];

function p(key: string, gamePlayerId: string, unlocked: boolean): AchievementProgressDTO {
  return {
    achievementKey: key,
    gamePlayerId,
    progress: unlocked ? 1 : 0,
    target: 1,
    unlockedAt: unlocked ? '2026-05-23T12:00:00.000Z' : null,
  };
}

describe('AchievementRoster', () => {
  it('counts unlocks per player and breaks out legendary count', () => {
    render(
      <MemoryRouter>
        <AchievementRoster
          gameId="g1"
          myGamePlayerId="gp1"
          definitions={defs}
          progressByPlayer={{
            gp1: [p('a', 'gp1', true), p('b', 'gp1', true)],
            gp2: [p('a', 'gp2', true)],
          }}
          usernames={{ gp1: 'alice', gp2: 'bob' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText(/2 unlocked · 1 leg/)).toBeInTheDocument();
    expect(screen.getByText(/1 unlocked · 0 leg/)).toBeInTheDocument();
  });

  it('puts the current player first and marks them with YOU', () => {
    render(
      <MemoryRouter>
        <AchievementRoster
          gameId="g1"
          myGamePlayerId="gp2"
          definitions={defs}
          progressByPlayer={{
            gp1: [p('a', 'gp1', true), p('b', 'gp1', true)],
            gp2: [p('a', 'gp2', true)],
          }}
          usernames={{ gp1: 'alice', gp2: 'bob' }}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole('link');
    expect(rows[0]).toHaveTextContent('bob');
    expect(screen.getByText('YOU')).toBeInTheDocument();
  });
});
