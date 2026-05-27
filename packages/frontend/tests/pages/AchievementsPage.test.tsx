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
  it('renders the viewer\'s unlocked cards and hides peer-only definitions', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        // Server payload carries the union across players (so the arena
        // Activity panel can render peer unlocks); the page must filter
        // to the viewer's own unlocked set.
        definitions: [
          { key: 'a', name: 'A', description: '', rarity: 'common',    icon: 'circle-dot', target: 1, enabled: true },
          { key: 'b', name: 'B', description: '', rarity: 'legendary', icon: 'gem',        target: 1, enabled: true },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
          gp2: [{ achievementKey: 'b', gamePlayerId: 'gp2', progress: 1, target: 1, unlockedAt: '2026-05-24T12:00:00.000Z' }],
        },
        totalEnabledCount: 2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockedUseGame.mockReturnValue({
      data: { id: 'g1', viewerGamePlayerId: 'gp1', leaderboard: [{ playerId: 'u1', gamePlayerId: 'gp1', username: 'alice', cashBalance: 1, totalValue: 1, rank: 1 }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useGame>);
    renderPage();
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    // Peer's unlocked achievement must not appear as a card on the viewer's page.
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('shows the unlock count over totalEnabledCount in the header', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'a', name: 'A', description: '', rarity: 'common', icon: 'circle-dot', target: 1, enabled: true },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
        },
        totalEnabledCount: 2,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockedUseGame.mockReturnValue({
      data: { id: 'g1', viewerGamePlayerId: 'gp1', leaderboard: [{ playerId: 'u1', gamePlayerId: 'gp1', username: 'alice', cashBalance: 1, totalValue: 1, rank: 1 }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useGame>);
    renderPage();
    await waitFor(() => expect(screen.getByText(/1 \/ 2 unlocked/i)).toBeInTheDocument());
  });

  it('renders a "N more locked" tile when the viewer has unlocked fewer than the total', async () => {
    mockedUseAchievements.mockReturnValue({
      data: {
        definitions: [
          { key: 'a', name: 'A', description: '', rarity: 'common', icon: 'circle-dot', target: 1, enabled: true },
        ],
        progress: {
          gp1: [{ achievementKey: 'a', gamePlayerId: 'gp1', progress: 1, target: 1, unlockedAt: '2026-05-23T12:00:00.000Z' }],
        },
        totalEnabledCount: 3,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAchievements>);
    mockedUseGame.mockReturnValue({
      data: { id: 'g1', viewerGamePlayerId: 'gp1', leaderboard: [{ playerId: 'u1', gamePlayerId: 'gp1', username: 'alice', cashBalance: 1, totalValue: 1, rank: 1 }] },
      isLoading: false,
    } as unknown as ReturnType<typeof useGame>);
    renderPage();
    await waitFor(() => expect(screen.getByText(/2 more locked/i)).toBeInTheDocument());
  });
});
