import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  ExternalLink,
  FileText,
  GraduationCap,
  Home,
  Kanban as KanbanIcon,
  LogOut,
  Menu,
  Moon,
  Plane,
  Sun,
  Upload,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../services/auth';
import { getTier, isAdmin } from '../config/team';

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: <Home className="h-[17px] w-[17px]" /> },
      { to: '/board', label: 'Workboard', icon: <KanbanIcon className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { to: '/companies', label: 'Companies', icon: <Building2 className="h-[17px] w-[17px]" /> },
      { to: '/procurement', label: 'Procurement', icon: <ClipboardList className="h-[17px] w-[17px]" /> },
      { to: '/payments', label: 'Payments', icon: <Wallet className="h-[17px] w-[17px]" />, adminOnly: true },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { to: '/conferences', label: 'Conferences', icon: <Plane className="h-[17px] w-[17px]" /> },
      { to: '/docs', label: 'Docs & agreements', icon: <FileText className="h-[17px] w-[17px]" /> },
      { to: '/elevatebridge', label: 'ElevateBridge', icon: <Briefcase className="h-[17px] w-[17px]" /> },
      { to: '/advisors', label: 'Advisors', icon: <GraduationCap className="h-[17px] w-[17px]" /> },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/alerts', label: 'Alerts', icon: <Bell className="h-[17px] w-[17px]" /> },
      { to: '/reports', label: 'Reports', icon: <BarChart3 className="h-[17px] w-[17px]" /> },
      { to: '/logframes', label: 'Logframes', icon: <BarChart3 className="h-[17px] w-[17px]" /> },
      { to: '/team', label: 'Team roster', icon: <Users className="h-[17px] w-[17px]" />, adminOnly: true },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/import', label: 'Bulk import', icon: <Upload className="h-[17px] w-[17px]" />, adminOnly: true },
      { to: '/admin/lookups', label: 'Lookups', icon: <ClipboardList className="h-[17px] w-[17px]" />, adminOnly: true },
    ],
  },
];

const EXTERNAL_LINKS = [
  { key: 'selection', label: 'Selection tool', url: 'https://elevateselection.zaidlab.xyz' },
  { key: 'advisors', label: 'Advisor pipeline', url: 'https://elevate-advisors.zaidlab.xyz' },
  { key: 'leaves', label: 'Leaves tracker', url: 'https://elevate-leaves.zaidlab.xyz' },
];

function buildSsoUrl(baseUrl: string): string {
  const token = localStorage.getItem('google_access_token');
  const expiry = localStorage.getItem('token_expiry');
  const email = localStorage.getItem('user_email');
  if (!token || !email) return baseUrl;
  return `${baseUrl}#access_token=${token}&user_email=${encodeURIComponent(email)}&token_expiry=${expiry || ''}`;
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
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const admin = user ? isAdmin(user.email) : false;
  const tier = user?.email ? getTier(user.email) : 'member';

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
          const visible = group.items.filter(i => !i.adminOnly || admin);
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
                    window.open(buildSsoUrl(link.url), '_blank', 'noopener,noreferrer');
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
          <Outlet />
        </div>
      </main>
    </div>
  );
}
