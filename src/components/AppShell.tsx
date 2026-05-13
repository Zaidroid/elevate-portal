import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  ExternalLink,
  FileText,
  GraduationCap,
  Home,
  Inbox,
  LogOut,
  Menu,
  Moon,
  Plane,
  RefreshCw,
  Sun,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../services/auth';
import { getTier, isAdmin } from '../config/team';
import { sessionEvents } from '../lib/sheets/client';
import { PersonalGreeting } from '../lib/greeting';
import { useModuleData } from '../data/useModuleData';
import { useEnvReport, useRegistryReport } from '../data/SheetDataProvider';
import type { Company, Assignment, ConferenceTrackerRow } from '../data/types';
import { computeAutopilotPlan, shouldRun, markRan, mintConferenceAssignmentId } from '../lib/maintenance/autopilot';
import { recordRun, outcomeFor } from '../lib/observability/last-run';
import { BackgroundTasksPill } from '../lib/observability/BackgroundTasksPill';

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  /** Show only to admins / leadership. */
  adminOnly?: boolean;
  /** Show only to AMs (profile_manager + member tiers). Used to hide
   *  "My hub" from admins, since they land on Home and don't have a
   *  pool to scope to. */
  amOnly?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Today',
    items: [
      { to: '/my-hub', label: 'My hub', icon: <Inbox className="h-[17px] w-[17px]" />, amOnly: true },
      { to: '/', label: 'Home', icon: <Home className="h-[17px] w-[17px]" />, adminOnly: true },
      { to: '/alerts', label: 'Alerts', icon: <Bell className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    label: 'Cohort',
    items: [
      { to: '/selection', label: 'Selection', icon: <CheckCircle2 className="h-[17px] w-[17px]" /> },
      { to: '/companies', label: 'Companies', icon: <Building2 className="h-[17px] w-[17px]" /> },
      { to: '/elevatebridge', label: 'ElevateBridge', icon: <Briefcase className="h-[17px] w-[17px]" /> },
      { to: '/conferences', label: 'Conferences', icon: <Plane className="h-[17px] w-[17px]" /> },
      { to: '/advisors', label: 'Advisors', icon: <GraduationCap className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/procurement', label: 'Procurement', icon: <ClipboardList className="h-[17px] w-[17px]" /> },
      { to: '/payments', label: 'Payments', icon: <Wallet className="h-[17px] w-[17px]" />, adminOnly: true },
      { to: '/docs', label: 'Docs & agreements', icon: <FileText className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { to: '/reports', label: 'Reports', icon: <BarChart3 className="h-[17px] w-[17px]" /> },
      { to: '/logframes', label: 'Logframes', icon: <BarChart3 className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/import', label: 'Bulk import', icon: <Upload className="h-[17px] w-[17px]" />, adminOnly: true },
      { to: '/admin/lookups', label: 'Lookups', icon: <ClipboardList className="h-[17px] w-[17px]" />, adminOnly: true },
      { to: '/team', label: 'Team roster', icon: <Users className="h-[17px] w-[17px]" />, adminOnly: true },
    ],
  },
];

const EXTERNAL_LINKS = [
  { key: 'selection', label: 'Selection tool', url: 'https://elevateselection.zaidlab.xyz' },
  { key: 'advisors', label: 'Advisor pipeline', url: 'https://elevate-advisors.zaidlab.xyz' },
  { key: 'leaves', label: 'Leaves tracker', url: 'https://elevate-leaves.zaidlab.xyz' },
];

// Open a linked tool and forward auth credentials via postMessage
// instead of URL fragments. The child window must signal readiness by
// posting { type: 'AUTH_READY' } to this origin.
function openLinkedTool(baseUrl: string): void {
  const token = localStorage.getItem('google_access_token');
  const email = localStorage.getItem('user_email');
  const expiry = localStorage.getItem('token_expiry');
  if (!token || !email) {
    window.open(baseUrl, '_blank');
    return;
  }

  const win = window.open(baseUrl, '_blank');
  if (!win) return; // popup blocked

  const targetOrigin = new URL(baseUrl).origin;
  const handler = (e: MessageEvent) => {
    if (e.origin !== targetOrigin) return;
    if (e.data?.type === 'AUTH_READY') {
      win.postMessage({
        type: 'AUTH_TOKEN',
        token,
        email,
        expiry: expiry || '',
      }, targetOrigin);
      window.removeEventListener('message', handler);
    }
  };
  window.addEventListener('message', handler);

  // Clean up after 30s in case child never signals readiness.
  setTimeout(() => window.removeEventListener('message', handler), 30_000);
}

const COHORT_TOTAL_WEEKS = 24;
const COHORT_START = new Date('2026-02-24'); // C3 kickoff — adjust as needed

function cohortWeek(): number {
  const now = new Date();
  const diffMs = now.getTime() - COHORT_START.getTime();
  const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(COHORT_TOTAL_WEEKS, weeks + 1));
}

export function AppShell({
  isDarkMode,
  toggleTheme,
}: {
  isDarkMode: boolean;
  toggleTheme: () => void;
}) {
  const { user, signOut, sessionExpiringSoon, sessionExpired, refreshing, extendSession } = useAuth();
  const navigate = useNavigate();
  const admin = user ? isAdmin(user.email) : false;
  const tier = user?.email ? getTier(user.email) : 'member';

  // ── Session banner state ───────────────────────────────────────────────
  // Tiered: ok < expiring (5 min warning, soft) < refreshing (user
  // clicked Extend, popup is open) < expired (real 401 from Google).
  type SessionWarning = 'ok' | 'expiring' | 'refreshing' | 'expired';
  const [sessionWarning, setSessionWarning] = useState<SessionWarning>('ok');

  useEffect(() => {
    if (sessionExpired) setSessionWarning('expired');
    else if (refreshing) setSessionWarning('refreshing');
    else if (sessionExpiringSoon) setSessionWarning('expiring');
    else setSessionWarning('ok');
  }, [sessionExpiringSoon, sessionExpired, refreshing]);

  // Hard logout signal from sheets/client.ts (only fired on second
  // consecutive 401, see request() in client.ts). Lets a runtime auth
  // failure still escalate to the red banner even if state lags.
  useEffect(() => {
    const onExpired = () => setSessionWarning('expired');
    sessionEvents.addEventListener('session-expired', onExpired);
    return () => sessionEvents.removeEventListener('session-expired', onExpired);
  }, []);
  // ────────────────────────────────────────────────────────────────────────

  // ── Autopilot: silent maintenance on admin login ──────────────────────
  // Once per browser tab session, after the cohort + assignments + tracker
  // have loaded, scan for drift and write the fixes. Strictly one-shot:
  // a useRef guard latches the moment we kick off and never resets, so
  // even if the dep array would otherwise re-fire (the useModuleData
  // hooks return fresh array references on every poll), the body
  // returns immediately. Without this guard the writes triggered the
  // provider's optimistic state update, which re-rendered AppShell,
  // which re-fired the effect, which wrote again — a 429-spamming
  // infinite loop.
  const masterHook     = useModuleData<Company>('companies', 'companies');
  const assignmentHook = useModuleData<Assignment>('companies', 'assignments');
  const trackerHook    = useModuleData<ConferenceTrackerRow>('conferences', 'tracker');
  const [autopilotMsg, setAutopilotMsg] = useState<string | null>(null);
  const autopilotStartedRef = useRef(false);
  // Latest hook accessor — read inside the effect via ref so we don't
  // capture a stale closure when the effect kicks off, but we also
  // don't add the hook to the dep array.
  const assignmentHookRef = useRef(assignmentHook);
  assignmentHookRef.current = assignmentHook;
  useEffect(() => {
    if (!admin) return;
    if (autopilotStartedRef.current) return;
    if (masterHook.loading || assignmentHook.loading || trackerHook.loading) return;
    if (masterHook.rows.length === 0 || assignmentHook.rows.length === 0) return;
    const plan = computeAutopilotPlan({
      companies: masterHook.rows,
      assignments: assignmentHook.rows,
      trackerRows: trackerHook.rows,
      trackerHeaders: trackerHook.headers,
    });
    if (!shouldRun(plan)) return;
    // Latch FIRST so re-fires while we're awaiting writes return immediately.
    autopilotStartedRef.current = true;
    (async () => {
      // Per-write try/catch — a single 429 or transient Sheets error
      // mustn't abort the rest of the loop (last cycle, the catch around
      // the full loop dropped 2 of 4 Conferences rows when one write
      // 429'd). Track success vs failure counts so we know whether to
      // markRan (skips next cycle) or leave the next reload to retry.
      let mkgOk = 0, mkgFail = 0;
      let confOk = 0, confFail = 0;
      const errors: string[] = [];
      for (const fix of plan.mkgFixes) {
        const id = fix.detail.split(':')[0].trim();
        if (!id) continue;
        try {
          await assignmentHookRef.current.updateRow(id, { sub_intervention: 'Marketing Agency' });
          mkgOk += 1;
        } catch (err) {
          mkgFail += 1;
          errors.push((err as Error).message || String(err));
        }
      }
      for (const add of plan.confAdds) {
        try {
          await assignmentHookRef.current.createRow({
            assignment_id: mintConferenceAssignmentId(add.company_id),
            company_id: add.company_id,
            intervention_type: 'MA',
            sub_intervention: 'Conferences',
            fund_code: '',
            start_date: '',
            end_date: '',
            owner_email: '',
            status: add.decision.toLowerCase() === 'attended' ? 'Completed' : 'In Progress',
            budget_usd: '',
            notes: `Auto-synced from Conference Tracker (${add.conference_name}, ${add.decision})`,
          });
          confOk += 1;
        } catch (err) {
          confFail += 1;
          errors.push((err as Error).message || String(err));
        }
      }

      // Only persist the "ran successfully" mark when EVERY row landed.
      // Partial failures leave the session-storage key unset so a
      // refresh tries again from a fresh state. If everything failed,
      // also clear the in-memory latch so a reload can retry.
      const allOk = mkgFail === 0 && confFail === 0;
      const noProgress = mkgOk === 0 && confOk === 0;
      if (allOk) {
        markRan(plan);
      } else if (noProgress) {
        autopilotStartedRef.current = false;
      }

      const total = mkgOk + confOk;
      const failed = mkgFail + confFail;
      if (total > 0 || failed > 0) {
        const parts: string[] = [];
        if (mkgOk > 0) parts.push(`${mkgOk} Marketing`);
        if (confOk > 0) parts.push(`${confOk} Conferences`);
        const ok = parts.length > 0 ? `synced ${parts.join(' + ')}` : 'no rows synced';
        const tail = failed > 0 ? ` · ${failed} failed (refresh to retry)` : '';
        setAutopilotMsg(`Autopilot ${ok}${tail}.`);
        window.setTimeout(() => setAutopilotMsg(null), failed > 0 ? 14000 : 8000);
        if (failed > 0) console.warn('[autopilot] partial failures:', errors);
        // Persistent pill — survives the auto-clearing toast.
        recordRun('Autopilot', {
          outcome: outcomeFor(total, failed),
          ok: total,
          fail: failed,
          message: `${ok}${tail}`,
          error: errors[0],
        });
      }
    })();
    // Deps are intentionally minimal: only the loaded-state booleans
    // and admin. The data reads inside the effect body see the latest
    // values via closure; the latch ref ensures we never re-enter.
  }, [
    admin,
    masterHook.loading, assignmentHook.loading, trackerHook.loading,
    masterHook.rows.length, assignmentHook.rows.length, trackerHook.rows.length,
  ]); // eslint-disable-line react-hooks/exhaustive-deps
  // ────────────────────────────────────────────────────────────────────────

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('nav_collapsed') === '1';
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('nav_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024 && mobileOpen) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mobileOpen]);

  const tierLabel =
    tier === 'leadership' ? 'Administrator' : tier === 'profile_manager' ? 'Profile Manager' : 'Team Member';
  const week = cohortWeek();
  const progress = Math.round((week / COHORT_TOTAL_WEEKS) * 100);

  const initials = user?.name
    ? user.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
    : '??';

  const sidebar = (
    <aside
      className={`relative flex h-full flex-col border-r border-slate-200 bg-white transition-[width] duration-200 dark:border-navy-700 dark:bg-navy-600 ${
        collapsed ? 'w-[76px]' : 'w-[260px]'
      }`}
    >
      {/* Brand lockup */}
      <button
        onClick={() => {
          navigate('/');
          setMobileOpen(false);
        }}
        className={`mx-3 mt-5 flex items-center border-b border-slate-200 pb-4 dark:border-navy-700 ${
          collapsed ? 'justify-center px-1' : 'justify-between px-2'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <img
            src="/elevate-logo.png"
            alt="Elevate"
            className={`h-12 w-auto flex-shrink-0 object-contain ${
              isDarkMode ? '[filter:brightness(0)_invert(1)]' : ''
            }`}
          />
        </div>
        {!collapsed && (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-navy-500 dark:bg-white/10 dark:text-white/80">
            C3
          </span>
        )}
      </button>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map(group => {
          const visible = group.items.filter(i => {
            if (i.adminOnly && !admin) return false;
            // amOnly: hide from admins (who land on Home and have no
            // pool to scope to). Leadership is admin-tier so also hidden.
            if (i.amOnly && admin) return false;
            return true;
          });
          if (visible.length === 0) return null;
          return (
            <div key={group.label}>
              {!collapsed && (
                <div className="mb-1.5 px-3 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {visible.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `group flex items-center rounded-[10px] text-[13.5px] font-semibold transition-all duration-150 ${
                        collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2'
                      } ${
                        isActive
                          ? 'bg-brand-red text-white shadow-brand-red'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-navy-500 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {item.icon}
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition-opacity ${
                                isActive ? 'opacity-60' : 'opacity-0 group-hover:opacity-40'
                              }`}
                            />
                          </>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}

        {!collapsed && (
          <div>
            <div className="mb-1.5 px-3 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
              Linked tools
            </div>
            <div className="space-y-0.5">
              {EXTERNAL_LINKS.map(link => (
                <a
                  key={link.key}
                  // Build the SSO URL on click, not at render time, so the
                  // token is always the freshest one in localStorage.
                  href="#"
                  onClick={e => {
                    e.preventDefault();
                    openLinkedTool(link.url);
                  }}
                  className="group flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-navy-500 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
                >
                  <span className="flex-1 truncate">{link.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 opacity-40 transition-opacity group-hover:opacity-80" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Cohort progress chip */}
        {!collapsed && (
          <div className="mx-1 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/5 dark:bg-white/5">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
              Cohort progress
            </div>
            <div className="mt-1 text-sm font-bold text-navy-500 dark:text-white">
              Week {week} / {COHORT_TOTAL_WEEKS}
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-brand-red transition-[width] duration-500 dark:bg-gradient-to-r dark:from-brand-red dark:to-brand-red-soft"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </nav>

      {/* Footer: user + theme toggle (segmented) */}
      <div className="border-t border-slate-200 px-3 py-3 dark:border-navy-700">
        {!collapsed ? (
          <>
            {user?.email && (
              <div className="mb-2 px-1 text-[12px] font-semibold leading-snug text-slate-500 dark:text-slate-400">
                <PersonalGreeting email={user.email} />
              </div>
            )}
            <div className="mb-3 flex items-center gap-2.5 px-1">
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt={user.name}
                  className="h-9 w-9 flex-shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-white/10"
                />
              ) : (
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-xs font-extrabold text-brand-teal">
                  {initials}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-navy-500 dark:text-white">
                  {user?.name}
                </div>
                <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                  {tierLabel}
                </div>
              </div>
              <button
                onClick={signOut}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-brand-red dark:text-slate-500 dark:hover:bg-white/5"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-[10px] border border-slate-200 bg-slate-50 p-0.5 dark:border-white/5 dark:bg-white/5">
              <button
                onClick={() => {
                  if (isDarkMode) toggleTheme();
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11.5px] font-bold transition-all ${
                  !isDarkMode
                    ? 'bg-white text-navy-500 shadow-sm dark:bg-navy-700 dark:text-white'
                    : 'text-slate-400 hover:text-navy-500 dark:text-slate-500 dark:hover:text-white'
                }`}
              >
                <Sun className="h-3 w-3" /> Light
              </button>
              <button
                onClick={() => {
                  if (!isDarkMode) toggleTheme();
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11.5px] font-bold transition-all ${
                  isDarkMode
                    ? 'bg-white text-navy-500 shadow-sm dark:bg-navy-700 dark:text-white'
                    : 'text-slate-400 hover:text-navy-500 dark:text-slate-500 dark:hover:text-white'
                }`}
              >
                <Moon className="h-3 w-3" /> Dark
              </button>
              <button
                onClick={() => setCollapsed(true)}
                className="hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-navy-500 dark:text-slate-500 dark:hover:bg-navy-700 dark:hover:text-white lg:flex"
                title="Collapse sidebar"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1">
            {user?.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-teal/10 text-[10px] font-extrabold text-brand-teal">
                {initials}
              </span>
            )}
            <button
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-navy-500 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-white"
              title={isDarkMode ? 'Light mode' : 'Dark mode'}
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setCollapsed(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-navy-500 dark:text-slate-500 dark:hover:bg-white/5 dark:hover:text-white"
              title="Expand sidebar"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
            <button
              onClick={signOut}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-brand-red dark:text-slate-500 dark:hover:bg-white/5"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-navy-500 dark:bg-navy-800 dark:text-slate-100">
      <div className="sticky top-0 hidden h-screen self-start lg:block">{sidebar}</div>

      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">{sidebar}</div>
        </>
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-navy-700 dark:bg-navy-800/80 lg:hidden">
          <button
            onClick={() => setMobileOpen(v => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-navy-700"
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <img
              src="/elevate-logo.png"
              alt="Elevate"
              className={`h-7 w-auto ${isDarkMode ? '[filter:brightness(0)_invert(1)]' : ''}`}
            />
            <span className="text-sm font-extrabold text-navy-500 dark:text-white">Elevate</span>
          </div>
        </div>

        <div className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {/* Session banner — soft warning at 5min remaining; user clicks Extend (no auto-popups). */}
          {sessionWarning === 'expiring' && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>Your session expires in a few minutes. Click <strong>Extend</strong> to keep working without re-signing in.</span>
              </div>
              <button
                onClick={() => extendSession()}
                className="flex-shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Extend
              </button>
            </div>
          )}
          {sessionWarning === 'refreshing' && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600 dark:border-navy-700 dark:bg-navy-700/50 dark:text-slate-300">
              <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
              <span>Extending your session — finish in the popup if it appears.</span>
            </div>
          )}
          {autopilotMsg && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>{autopilotMsg}</span>
            </div>
          )}
          {admin && <EnvMissingBanner />}
          {admin && <SchemaDriftBanner />}
          {sessionWarning === 'expired' && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>Session expired. Please re-sign in to continue working.</span>
              </div>
              <button
                onClick={() => { signOut(); navigate('/'); }}
                className="flex-shrink-0 rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
              >
                Re-sign in
              </button>
            </div>
          )}
          <Outlet />
        </div>
      </main>
      <BackgroundTasksPill />
    </div>
  );
}

// Admin-only banner: required workbook env vars not set. Visible only
// to leadership; non-admins see nothing.
function EnvMissingBanner() {
  const env = useEnvReport();
  if (env.ok) return null;
  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <div className="font-semibold">{env.missingRequired.length} required workbook(s) not configured</div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {env.missingRequired.map(m => (
              <li key={m.envVar}>
                <code className="rounded bg-white px-1 dark:bg-red-900">{m.envVar}</code>
                {' — '}{m.label}
              </li>
            ))}
          </ul>
          {env.missingOptional.length > 0 && (
            <div className="mt-1 text-[11px] opacity-80">
              {env.missingOptional.length} optional workbook(s) also unconfigured (form auto-sync, donor reports, etc.).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Admin-only banner: surfaces sheets.ts ↔ registry.ts drift detected at
// boot. Visible only to leadership; non-admins see nothing.
function SchemaDriftBanner() {
  const report = useRegistryReport();
  const navigate = useNavigate();
  if (report.ok) return null;
  const msg = [
    report.missing.length > 0 && `${report.missing.length} tab(s) missing from registry`,
    report.orphan.length > 0 && `${report.orphan.length} orphan registry entry`,
  ].filter(Boolean).join(' · ');
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        <span><strong>Schema drift:</strong> {msg}. Open the Schema Doctor to investigate.</span>
      </div>
      <button
        onClick={() => navigate('/admin/schema')}
        className="flex-shrink-0 rounded-md bg-amber-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-800"
      >
        Open
      </button>
    </div>
  );
}
