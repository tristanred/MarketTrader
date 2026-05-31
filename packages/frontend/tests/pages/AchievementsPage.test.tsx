import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { AchievementsPage } from '@/pages/AchievementsPage';

vi.mock('@/api/achievements', () => ({
  getGameAchievements: vi.fn().mockResolvedValue({
    definitions: [
      { key: 'a', name: 'A', description: '', rarity: 'common',    icon: 'circle-dot', target: 1, enabled: true },
    ],
    progress: {
      gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
    },
    totalEnabledCount: 2,
  }),
  getPlayerAchievements: vi.fn(),
  ackAchievementUnlock: vi.fn(),
  useAchievements: vi.fn(),
  achievementKeys: {
    all: ['achievements'],
    game: (g: string) => ['achievements', g, 'all'],
    player: (g: string, p: string) => ['achievements', g, p],
  },
}));

vi.mock('@/api/games', () => ({
  useGame: vi.fn(),
  gameKeys: {
    all: ['games'],
    list: () => ['games', 'list'],
    detail: (id: string) => ['games', 'detail', id],
  },
}));

// Wire up the mocked hooks for each test
import { useAchievements } from '@/api/achievements';
import { useGame } from '@/api/games';

const mockedUseAchievements = vi.mocked(useAchievements);
const mockedUseGame = vi.mocked(useGame);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/games/g1/achievements']}>
        <Routes>
          <Route path="/games/:gameId/achievements" element={<AchievementsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AchievementsPage', () => {
  function mockGame() {
    mockedUseGame.mockReturnValue({
      data: { id: 'g1', viewerGamePlayerId: 'gp1', leaderboard: [{ playerId: 'u1', gamePlayerId: 'gp1', username: 'alice', cashBalance: 1, totalValue: 1, rank: 1 }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useGame>);
  }

  it('renders unlocked cards AND locked cards for not-yet-unlocked definitions', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'a', name: 'Aye', description: 'unlocked one', rarity: 'common',    icon: 'circle-dot', target: 1, enabled: true, secret: false },
          { key: 'b', name: 'Bee', description: 'locked one',   rarity: 'legendary', icon: 'gem',        target: 1, enabled: true, secret: false },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
        },
        totalEnabledCount: 2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockGame();
    renderPage();
    await waitFor(() => expect(screen.getByText('Aye')).toBeInTheDocument());
    // Locked, non-secret definition is now shown (was hidden before this feature).
    expect(screen.getByText('Bee')).toBeInTheDocument();
  });

  it('shows in-progress count on a locked-but-started card', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'c', name: 'Cee', description: 'in progress', rarity: 'uncommon', icon: 'repeat-2', target: 5, enabled: true, secret: false },
        ],
        progress: {
          gp1: [{ achievementKey: 'c', gamePlayerId: 'gp1', progress: 2, target: 5, unlockedAt: null }],
        },
        totalEnabledCount: 1,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockGame();
    renderPage();
    await waitFor(() => expect(screen.getByText('Cee')).toBeInTheDocument());
    expect(screen.getByText(/2 \/ 5/)).toBeInTheDocument();
  });

  it('shows the unlock count over totalEnabledCount in the header', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'a', name: 'Aye', description: '', rarity: 'common', icon: 'circle-dot', target: 1, enabled: true, secret: false },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
        },
        totalEnabledCount: 2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockGame();
    renderPage();
    await waitFor(() => expect(screen.getByText(/1 \/ 2 unlocked/i)).toBeInTheDocument());
  });

  it('shows a "N secret" tile when enabled count exceeds visible definitions', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'a', name: 'Aye', description: '', rarity: 'common', icon: 'circle-dot', target: 1, enabled: true, secret: false },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
        },
        totalEnabledCount: 3, // 2 secret achievements not surfaced
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockGame();
    renderPage();
    await waitFor(() => expect(screen.getByText(/2 secret/i)).toBeInTheDocument());
  });
});
