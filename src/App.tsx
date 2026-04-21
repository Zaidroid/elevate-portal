import { useState, useEffect } from 'react';
import { useAuth } from './services/auth';
import { RefreshCw, Users, Calendar, ClipboardCheck, ArrowRight, LogOut, Lock, Rocket, ShieldCheck, Sun, Moon } from 'lucide-react';

const TOOLS = [
  {
    id: 'advisors',
    name: 'Advisor Pipeline',
    description: 'Manage and track advisor relationships, scores, and follow-ups.',
    icon: Users,
    url: 'https://elevate-advisors.zaidlab.xyz',
    color: 'from-blue-500 to-indigo-600',
    hoverColor: 'group-hover:text-indigo-600',
  },
  {
    id: 'selection',
    name: 'Selection Tool',
    description: 'Evaluate, score, and shortlist applications for the Elevate program.',
    icon: ClipboardCheck,
    url: 'https://elevateselection.zaidlab.xyz',
    color: 'from-emerald-500 to-teal-600',
    hoverColor: 'group-hover:text-teal-600',
  },
  {
    id: 'leaves',
    name: 'Leaves Tracker',
    description: 'Track and manage team vacation, sick leaves, and time off.',
    icon: Calendar,
    url: 'https://elevate-leaves.zaidlab.xyz',
    color: 'from-amber-500 to-orange-600',
    hoverColor: 'group-hover:text-orange-600',
  }
];

function FloatingBackground({ isDarkMode = true }: { isDarkMode?: boolean }) {
  const [floatingShapes, setFloatingShapes] = useState<Array<{ x: number; y: number; size: number; duration: number; delay: number }>>([]);

  useEffect(() => {
    const shapes = Array.from({ length: 12 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 250 + 100,
      duration: Math.random() * 20 + 10,
      delay: Math.random() * 5,
    }));
    setFloatingShapes(shapes);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {floatingShapes.map((shape, i) => (
        <div
          key={i}
          className={`absolute rounded-full animate-float ${isDarkMode ? 'opacity-30' : 'opacity-50 mix-blend-multiply'}`}
          style={{
            left: `${shape.x}%`,
            top: `${shape.y}%`,
            width: shape.size,
            height: shape.size,
            background: isDarkMode 
              ? (i % 3 === 0
                ? 'linear-gradient(135deg, #6366f1, #a855f7)'
                : i % 3 === 1
                  ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)'
                  : 'linear-gradient(135deg, #8b5cf6, #ec4899)')
              : (i % 3 === 0
                ? 'linear-gradient(135deg, #818cf8, #c084fc)'
                : i % 3 === 1
                  ? 'linear-gradient(135deg, #60a5fa, #a78bfa)'
                  : 'linear-gradient(135deg, #a78bfa, #f472b6)'),
            animationDuration: `${shape.duration}s`,
            animationDelay: `${shape.delay}s`,
            filter: 'blur(50px)',
          }}
        />
      ))}
    </div>
  );
}

function ToolSelectionPage({ toggleTheme, isDarkMode }: { toggleTheme: () => void, isDarkMode: boolean }) {
  const { user, signOut } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    setIsLoaded(true);
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 18) setGreeting('Good afternoon');
    else setGreeting('Good evening');
  }, []);

  const firstName = user?.name?.split(' ')[0] || 'Team';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F19] flex flex-col relative overflow-hidden transition-colors duration-500">
      <FloatingBackground isDarkMode={isDarkMode} />
      
      {/* Header */}
      <header className={`relative z-20 px-8 py-6 flex justify-between items-center transition-all duration-1000 ease-out ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
        <div className="flex items-center gap-6">
          <img src="/elevate-logo.png" alt="Logo" className="h-20 object-contain drop-shadow-2xl" />
          <div className="hidden sm:block border-l border-slate-300 dark:border-white/10 pl-6 py-1">
            <h1 className="text-slate-900 dark:text-white font-semibold tracking-wide text-lg">Workspace</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-5 bg-white/80 dark:bg-white/5 backdrop-blur-xl px-5 py-2.5 rounded-full border border-slate-200/80 dark:border-white/10 shadow-sm dark:shadow-lg">
          <button 
            onClick={toggleTheme}
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-all duration-300 group shadow-sm dark:shadow-none bg-white/50 dark:bg-transparent"
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun className="w-5 h-5 group-hover:rotate-45 transition-transform" /> : <Moon className="w-5 h-5 group-hover:-rotate-12 transition-transform" />}
          </button>
          
          <div className="w-px h-8 bg-slate-200 dark:bg-white/10" />
          
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{user?.name}</p>
              <p className="text-xs text-indigo-600 dark:text-indigo-300 font-medium uppercase tracking-wider">{user?.role === 'admin' ? 'Administrator' : 'Team Member'}</p>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500 rounded-full blur-md opacity-20 dark:opacity-40"></div>
              <img src={user?.picture || `https://ui-avatars.com/api/?name=${user?.name}&background=4f46e5&color=fff&bold=true`} alt={user?.name} className="relative w-10 h-10 rounded-full border-2 border-white dark:border-white/10 shadow-sm dark:shadow-none object-cover" />
            </div>
          </div>
          <div className="w-px h-8 bg-slate-200 dark:bg-white/10" />
          <button 
            onClick={signOut}
            className="text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-white p-2 hover:bg-red-50 dark:hover:bg-white/10 rounded-full transition-all duration-300 group"
            title="Sign out"
          >
            <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10 flex flex-col items-center justify-center p-6 sm:p-12 mb-10">
        <div className={`max-w-6xl w-full transition-all duration-1000 delay-150 ease-out ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
          <div className="text-center mb-20">
            <h2 className="text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-slate-800 via-indigo-900 to-slate-500 dark:from-white dark:via-indigo-50 dark:to-slate-400 tracking-tight pb-2 mb-4 transition-all duration-500 leading-tight">
              {greeting}, {firstName}.
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-xl max-w-2xl mx-auto font-medium transition-colors duration-500">
              Select a workspace to begin. You are securely authenticated across all Elevate tools.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {TOOLS.map((tool, idx) => {
              const Icon = tool.icon;
              // Pass SSO tokens in hash
              let toolUrl = tool.url;
              const token = localStorage.getItem('google_access_token');
              const expiry = localStorage.getItem('token_expiry');
              const email = localStorage.getItem('user_email');
              if (token && email) {
                 toolUrl = `${toolUrl}#access_token=${token}&user_email=${encodeURIComponent(email)}&token_expiry=${expiry || ''}`;
              }
              
              return (
                <a
                  key={tool.id}
                  href={toolUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`group relative flex flex-col p-10 rounded-[2.5rem] bg-white/40 dark:bg-transparent dark:bg-gradient-to-b dark:from-white/[0.08] dark:to-white/[0.02] hover:bg-white/60 dark:hover:bg-transparent dark:hover:from-white/[0.12] dark:hover:to-white/[0.05] border border-white/60 dark:border-white/10 backdrop-blur-3xl transition-all duration-500 ease-out hover:-translate-y-3 shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-2xl dark:hover:shadow-[0_0_80px_-20px_rgba(79,70,229,0.3)] animate-fade-in-up`}
                  style={{ animationDelay: `${idx * 0.15 + 0.3}s` }}
                >
                  {/* Subtle color glow based on tool */}
                  <div className={`absolute inset-0 rounded-[2.5rem] bg-gradient-to-br ${tool.color} opacity-0 dark:opacity-0 group-hover:opacity-[0.03] dark:group-hover:opacity-5 transition-opacity duration-700`} />
                  
                  <div className="mb-8 flex justify-between items-start relative z-10">
                    <div className={`w-16 h-16 rounded-2xl bg-white/70 dark:bg-transparent dark:bg-gradient-to-br dark:from-white/10 dark:to-white/5 flex items-center justify-center border border-white/80 shadow-sm dark:shadow-inner transition-all duration-500 group-hover:scale-110 group-hover:rotate-6 group-hover:shadow-md dark:group-hover:shadow-[0_0_30px_-5px_rgba(255,255,255,0.2)]`}>
                      <Icon className={`w-8 h-8 text-slate-500 dark:text-slate-300 ${tool.hoverColor} transition-colors duration-500`} />
                    </div>
                    <div className="w-10 h-10 rounded-full bg-white/60 dark:bg-white/5 flex items-center justify-center group-hover:bg-white dark:group-hover:bg-white/10 transition-all duration-500 group-hover:scale-110 border border-white dark:border-transparent shadow-sm dark:shadow-none">
                      <ArrowRight className={`w-5 h-5 text-slate-400 ${tool.hoverColor} transition-all duration-500 group-hover:translate-x-1`} />
                    </div>
                  </div>

                  <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-4 tracking-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-indigo-600 group-hover:to-blue-500 dark:group-hover:from-white dark:group-hover:to-slate-300 transition-all duration-300 relative z-10">{tool.name}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed flex-1 font-medium group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors duration-300 relative z-10">{tool.description}</p>
                </a>
              );
            })}
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-slate-500 text-sm">
        Gaza Sky Geeks © 2026 • Elevate Program
      </footer>
    </div>
  );
}

function AuthGate({ toggleTheme, isDarkMode }: { toggleTheme: () => void, isDarkMode: boolean }) {
  const { isAuthenticated, isLoading, error, signIn } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
        <p className="text-sm text-slate-400">Authenticating…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F19] flex items-center justify-center p-4 relative overflow-hidden transition-colors duration-500">
        <FloatingBackground isDarkMode={isDarkMode} />

        {/* Theme Toggle inside login screen */}
        <div className="absolute top-6 right-6 z-20">
          <button 
            onClick={toggleTheme}
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white p-3 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-all duration-300 group shadow-sm dark:shadow-none bg-white/50 dark:bg-transparent backdrop-blur-md"
            title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDarkMode ? <Sun className="w-5 h-5 group-hover:rotate-45 transition-transform" /> : <Moon className="w-5 h-5 group-hover:-rotate-12 transition-transform" />}
          </button>
        </div>

        {/* Main content */}
        <div className={`relative z-10 max-w-md w-full transition-all duration-1000 ease-out ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Logo Section */}
          <div className="text-center mb-10">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/30 blur-3xl rounded-full animate-pulse" />
              <img
                src="/elevate-logo.png"
                alt="Elevate Logo"
                className="relative h-48 w-auto object-contain mx-auto mb-6 drop-shadow-2xl animate-fade-in-up"
                style={{ animationDelay: '0.2s' }}
              />
            </div>
            <h1
              className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-800 to-indigo-600 dark:from-white dark:to-indigo-300 tracking-tight pb-1 animate-fade-in-up transition-colors duration-500 leading-tight"
              style={{ animationDelay: '0.4s' }}
            >
              Command Center
            </h1>
          </div>

          {/* Login Card */}
          <div
            className="relative bg-white/60 dark:bg-white/10 backdrop-blur-3xl rounded-3xl p-8 border border-white/80 dark:border-white/20 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-2xl animate-fade-in-up overflow-hidden transition-colors duration-500"
            style={{ animationDelay: '0.6s' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 dark:from-white/5 to-transparent" />

            <div className="relative">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-2 transition-colors duration-500">Welcome Back</h2>
                <p className="text-sm text-slate-500 dark:text-slate-300 transition-colors duration-500">Sign in with your Gaza Sky Geeks account</p>
              </div>

              {error && (
                <div className="bg-red-500/20 border border-red-500/30 backdrop-blur-md rounded-xl p-3 mb-4">
                  <p className="text-xs text-red-200 text-center">{error}</p>
                </div>
              )}

              {/* Google Sign-In Button */}
              <div className="flex justify-center mb-6">
                <button
                  onClick={signIn}
                  className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-white hover:bg-slate-50 border border-transparent rounded-xl text-sm font-semibold text-slate-800 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-[1.02]"
                >
                  <svg width="20" height="20" viewBox="0 0 48 48">
                    <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  Sign in with Google
                </button>
              </div>

              {/* Features */}
              <div className="space-y-3">
                {[
                  { icon: <Lock className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />, title: 'Unified Access', desc: 'One login for all Elevate apps' },
                  { icon: <Rocket className="w-5 h-5 text-purple-500 dark:text-purple-400" />, title: 'Quick Launch', desc: 'Seamlessly switch between tools' },
                  { icon: <ShieldCheck className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />, title: 'Secure Gateway', desc: 'Authorized team members only' },
                ].map((feature, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 p-3 rounded-xl bg-white/40 dark:bg-white/5 border border-white/60 dark:border-white/10 hover:bg-white/60 dark:hover:bg-white/10 transition-colors duration-300"
                  >
                    {feature.icon}
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-white transition-colors duration-500">{feature.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-300 transition-colors duration-500">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Access Notice */}
              <div className="mt-6 p-3 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-xl text-center transition-colors duration-500">
                <p className="text-xs text-indigo-600 dark:text-indigo-200 font-medium tracking-wide transition-colors duration-500">
                  RESTRICTED TO @GAZASKYGEEKS.COM
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-8 animate-fade-in-up" style={{ animationDelay: '1s' }}>
            <p className="text-xs text-slate-500 dark:text-slate-500">
              Gaza Sky Geeks © 2026 • Elevate Program
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <ToolSelectionPage toggleTheme={toggleTheme} isDarkMode={isDarkMode} />;
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check local storage or system preference
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        return savedTheme === 'dark';
      }
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

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  return <AuthGate toggleTheme={toggleTheme} isDarkMode={isDarkMode} />;
}
