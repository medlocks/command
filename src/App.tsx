import { NavLink, Route, Routes } from 'react-router';
import type { ComponentType, SVGProps } from 'react';
import { WarehouseProvider } from '@/modules/insight-engine/WarehouseProvider';
import { RecommendationOverridesProvider } from '@/modules/recommendations/RecommendationOverridesProvider';
import { ImportSessionProvider, DataImportPage } from '@/modules/data-ingestion';
import { HomePage } from '@/modules/dashboard';
import { ClientsPage } from '@/modules/clients';
import { MarketingPage } from '@/modules/marketing';
import { TeamPage } from '@/modules/team';
import { GrowthRoadmapPage } from '@/modules/growth-roadmap';
import { ChatPage } from '@/modules/chat';
import { SettingsPage } from '@/modules/settings';
import { StockPage } from '@/modules/stock';
import { ManualDataPage } from '@/modules/manual-data';
import {
  ChatIcon,
  ClientsIcon,
  HomeIcon,
  MarketingIcon,
  RoadmapIcon,
  SettingsIcon,
  TeamIcon,
} from '@/shared/ui/icons';

interface Tab {
  to: string;
  label: string;
  end?: boolean;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// Requirements Section 7.2 — the 7 primary tabs, none marked secondary, so
// the bottom nav shows all of them at once (icon-only; the active tab
// alone gets a label) rather than splitting some off into a "More" menu.
const TABS: Tab[] = [
  { to: '/', label: 'Home', end: true, Icon: HomeIcon },
  { to: '/clients', label: 'Clients', Icon: ClientsIcon },
  { to: '/marketing', label: 'Marketing', Icon: MarketingIcon },
  { to: '/team', label: 'Team', Icon: TeamIcon },
  { to: '/roadmap', label: 'Roadmap', Icon: RoadmapIcon },
  { to: '/chat', label: 'Chat', Icon: ChatIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

function NavBar() {
  return (
    <nav className="flex border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ to, label, end, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors ${
              isActive ? 'text-[var(--color-accent-strong)]' : 'text-[var(--color-ink-muted)]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="h-6 w-6" strokeWidth={isActive ? 2 : 1.75} />
              <span className={`text-[10px] font-medium transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  return (
    <WarehouseProvider>
      {/* Shared session-only state for to-do status/notes (Requirements Section
          5.4.1) — sits alongside WarehouseProvider so every route, including
          Chat, reads the same overrides. See the Provider's own doc comment:
          this is in-memory only, not real persistence. */}
      <RecommendationOverridesProvider>
        {/* Isolated session store for real Fresha CSV uploads (Requirements
            Section 3.1) — deliberately its own sibling provider, never merged
            into WarehouseProvider's mock feed. See the Provider's own doc
            comment for why. */}
        <ImportSessionProvider>
          <div
            className="flex h-screen flex-col"
            style={{
              backgroundColor: 'var(--color-page)',
              backgroundImage:
                'linear-gradient(160deg, var(--color-gradient-start) 0%, var(--color-gradient-mid) 45%, var(--color-gradient-end) 100%)',
            }}
          >
            <main className="flex-1 overflow-y-auto">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/marketing" element={<MarketingPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/roadmap" element={<GrowthRoadmapPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* Not in the tab bar — Section 7.2's 7-tab set is fixed; reachable via a link from Settings/Home instead (Section 13, Q18 — the real staff access path is still open). */}
                <Route path="/stock" element={<StockPage />} />
                <Route path="/data-import" element={<DataImportPage />} />
                <Route path="/manual-data" element={<ManualDataPage />} />
              </Routes>
            </main>
            <NavBar />
          </div>
        </ImportSessionProvider>
      </RecommendationOverridesProvider>
    </WarehouseProvider>
  );
}
