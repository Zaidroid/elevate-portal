import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Lock, Moon, RefreshCw, Rocket, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from './services/auth';
import { loadTeamRosterFromSheet } from './config/team';
import { AppShell } from './components/AppShell';
import { CompaniesPage } from './pages/companies/CompaniesPage';
import { CompanyDetailPage } from './pages/companies/CompanyDetailPage';
import { SelectionPage } from './pages/selection/SelectionPage';
import { DocsPage } from './pages/docs/DocsPage';
import { ProcurementPage } from './pages/procurement/ProcurementPage';
import { PaymentsPage } from './pages/payments/PaymentsPage';
import { ConferencesPage } from './pages/conferences/ConferencesPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { FreelancersPage } from './pages/freelancers/FreelancersPage';
import { AdvisorsPage } from './pages/advisors/AdvisorsPage';
import { TeamPage } from './pages/team/TeamPage';
import { AlertsPage } from './pages/alerts/AlertsPage';
import { LookupsPage } from './pages/admin/LookupsPage';
import { LogframesPage } from './pages/logframes/LogframesPage';
import { BridgePage } from './pages/link/BridgePage';
import { MyHubPage } from './pages/hub/MyHubPage';
import { LandingRouter, RequireAdmin } from './components/guards';
// Lazy: ImportPage pulls in xlsx (~350 KB), keep it out of the main bundle.
const ImportPage = lazy(() => import('./pages/import/ImportPage').then(m => ({ default: m.ImportPage })));
import { ToastProvider } from './lib/ui';
import { SheetDataProvider } from './data/SheetDataProvider';

// Soft, slow-floating background blobs. Pure CSS — no JS animation loop.
// Three blobs at brand colours, drifting in 18s/22s/26s cycles, blurred and
// low-opacity so they read as ambience, not noise. Both light + dark.
function FloatingBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-brand-red/15 blur-3xl dark:bg-brand-red/20"
           style={{ animation: 'login-blob-a 22s ease-in-out infinite' }} />
      <div className="absolute -right-40 top-1/3 h-[460px] w-[460px] rounded-full bg-brand-teal/15 blur-3xl dark:bg-brand-teal/20"
           style={{ animation: 'login-blob-b 26s ease-in-out infinite' }} />
      <div className="absolute -bottom-32 left-1/4 h-[380px] w-[380px] rounded-full bg-brand-orange/10 blur-3xl dark:bg-brand-orange/15"
           style={{ animation: 'login-blob-c 18s ease-in-out infinite' }} />
      <style>{`
        @keyframes login-blob-a { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,30px) scale(1.08); } }
        @keyframes login-blob-b { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-50px,40px) scale(0.95); } }
        @keyframes login-blob-c { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,-40px) scale(1.05); } }
      `}</style>
    </div>
  );
}

function LoginScreen({ isDarkMode, toggleTheme }: { isDarkMode: boolean; toggleTheme: () => void }) {
  const { error, signIn } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 p-4 transition-colors duration-500 dark:bg-navy-800">
      <FloatingBackground />

      <div className="absolute right-6 top-6 z-20">
        <button
          onClick={toggleTheme}
          className="group rounded-xl bg-white/60 p-3 text-slate-500 shadow-sm backdrop-blur-md transition-all hover:bg-slate-200 hover:text-navy-500 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDarkMode ? (
            <Sun className="h-5 w-5 transition-transform group-hover:rotate-45" />
          ) : (
            <Moon className="h-5 w-5 transition-transform group-hover:-rotate-12" />
          )}
        </button>
      </div>

      <div
        className={`relative z-10 w-full max-w-md transition-all duration-1000 ease-out ${
          isLoaded ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
        }`}
      >
        {/* Hero — logo with brand-red glow */}
        <div className="mb-8 text-center">
          <div className="relative inline-block">
            <div className="absolute inset-0 animate-pulse rounded-full bg-brand-red/15 blur-3xl dark:bg-brand-red/30" />
            <img
              src="/elevate-logo.png"
              alt="Elevate"
              className={`relative mx-auto mb-5 h-32 w-auto object-contain drop-shadow-2xl ${isDarkMode ? '[filter:brightness(0)_invert(1)]' : ''}`}
            />
          </div>
          <div className="text-2xs font-bold uppercase tracking-[0.2em] text-brand-red">
            Gaza Sky Geeks · Cohort 3
          </div>
          <h1 className="mt-2 pb-1 text-3xl font-extrabold tracking-tight text-navy-500 dark:text-white">
            Elevate Command Center
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            One sign-in for every workspace your team uses.
          </p>
        </div>

        {/* Sign-in card */}
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white/80 p-7 shadow-card backdrop-blur-2xl transition-colors duration-500 dark:border-navy-700 dark:bg-navy-600/90">
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-center text-xs text-red-700 dark:text-red-200">{error}</p>
            </div>
          )}

          <button
            onClick={signIn}
            className="group mb-5 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-semibold text-navy-500 shadow-lg ring-1 ring-slate-200 transition-all hover:scale-[1.02] hover:shadow-xl dark:ring-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            <span>Sign in with Google</span>
          </button>

          <div className="space-y-2.5">
            {[
              { icon: <Lock className="h-4 w-4 text-brand-red" />, title: 'Unified access', desc: 'One login for every Elevate tool.' },
              { icon: <Rocket className="h-4 w-4 text-brand-teal" />, title: 'Sheet-backed', desc: 'Every module syncs to Google Sheets.' },
              { icon: <ShieldCheck className="h-4 w-4 text-brand-orange" />, title: 'Secure gateway', desc: 'Authorised team members only.' },
            ].map((feature, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/40 px-3 py-2 dark:border-navy-700 dark:bg-navy-700/40"
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm dark:bg-navy-700">
                  {feature.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-navy-500 dark:text-white">{feature.title}</p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-300">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Quieter authorisation footnote — replaces the loud red banner. */}
          <p className="mt-5 text-center text-[11px] text-slate-500 dark:text-slate-400">
            Restricted to <span className="font-semibold text-navy-500 dark:text-white">@gazaskygeeks.com</span>.
            Not on the roster? Message Zaid Salem to be added.
          </p>
        </div>

        <div className="mt-7 text-center text-[11px] text-slate-500">
          Gaza Sky Geeks © 2026 · Elevate Program
        </div>
      </div>
    </div>
  );
}

function AuthGate({
  isDarkMode,
  toggleTheme,
}: {
  isDarkMode: boolean;
  toggleTheme: () => void;
}) {
  const { isAuthenticated, isLoading } = useAuth();

  // Refresh the team roster from VITE_SHEET_TEAM_ROSTER once after sign-in.
  // Hardcoded fallback in src/config/team.ts continues to gate auth on failure.
  useEffect(() => {
    if (isAuthenticated) {
      void loadTeamRosterFromSheet();
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-navy-800">
        <RefreshCw className="h-8 w-8 animate-spin text-brand-red" />
        <p className="text-sm text-slate-500">Authenticating…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen isDarkMode={isDarkMode} toggleTheme={toggleTheme} />;
  }

  return (
    <SheetDataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell isDarkMode={isDarkMode} toggleTheme={toggleTheme} />}>
            <Route index element={<LandingRouter />} />
            <Route path="/my-hub" element={<MyHubPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:id" element={<CompanyDetailPage />} />
            <Route path="/selection" element={<SelectionPage />} />
            <Route path="/procurement" element={<ProcurementPage />} />
            <Route path="/payments" element={<RequireAdmin><PaymentsPage /></RequireAdmin>} />
            <Route path="/conferences" element={<ConferencesPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/elevatebridge" element={<FreelancersPage />} />
            <Route path="/freelancers" element={<Navigate to="/elevatebridge" replace />} />
            <Route path="/advisors" element={<AdvisorsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/team" element={<RequireAdmin><TeamPage /></RequireAdmin>} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/admin/lookups" element={<RequireAdmin><LookupsPage /></RequireAdmin>} />
            <Route path="/logframes" element={<LogframesPage />} />
            <Route path="/link/:app" element={<BridgePage />} />
            <Route
              path="/import"
              element={
                <RequireAdmin>
                  <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading import tools…</div>}>
                    <ImportPage />
                  </Suspense>
                </RequireAdmin>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SheetDataProvider>
  );
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) return savedTheme === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(v => !v);

  return (
    <ToastProvider>
      <AuthGate isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
    </ToastProvider>
  );
}
