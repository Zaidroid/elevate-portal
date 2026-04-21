import { useState, useEffect } from 'react';
import { useAuth } from './services/auth';
import { RefreshCw, Users, Calendar, ClipboardCheck, ArrowRight, LogOut } from 'lucide-react';

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

function FloatingBackground() {
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
          className="absolute rounded-full opacity-30 animate-float"
          style={{
            left: `${shape.x}%`,
            top: `${shape.y}%`,
            width: shape.size,
            height: shape.size,
            background: i % 3 === 0
              ? 'linear-gradient(135deg, #6366f1, #a855f7)'
              : i % 3 === 1
                ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)'
                : 'linear-gradient(135deg, #8b5cf6, #ec4899)',
            animationDuration: `${shape.duration}s`,
            animationDelay: `${shape.delay}s`,
            filter: 'blur(50px)',
          }}
        />
      ))}
    </div>
  );
}

function ToolSelectionPage() {
  const { user, signOut } = useAuth();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col relative overflow-hidden">
      <FloatingBackground />
      
      {/* Header */}
      <header className={`relative z-10 p-6 flex justify-between items-center transition-all duration-1000 ease-out ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
            <img src="/elevate-logo.png" alt="Logo" className="h-6 object-contain" />
          </div>
          <div>
            <h1 className="text-white font-semibold tracking-tight">Elevate Portal</h1>
            <p className="text-slate-400 text-xs">Command Center</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 bg-white/5 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          <div className="flex items-center gap-3">
            <img src={user?.picture || `https://ui-avatars.com/api/?name=${user?.name}&background=6366f1&color=fff`} alt={user?.name} className="w-8 h-8 rounded-full border border-white/20" />
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-white">{user?.name}</p>
              <p className="text-xs text-slate-400">{user?.role}</p>
            </div>
          </div>
          <div className="w-px h-6 bg-white/10 mx-2" />
          <button 
            onClick={signOut}
            className="text-slate-300 hover:text-white p-1 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10 flex flex-col items-center justify-center p-6 sm:p-12">
        <div className={`max-w-5xl w-full transition-all duration-1000 delay-150 ease-out ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 tracking-tight mb-4">
              Where to today?
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Select an application to launch. You are securely signed in across all Elevate platforms.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
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
                  className={`group relative flex flex-col p-8 rounded-3xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 backdrop-blur-xl transition-all duration-500 ease-out hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] animate-fade-in-up`}
                  style={{ animationDelay: `${idx * 0.15 + 0.3}s` }}
                >
                  <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${tool.color} opacity-0 group-hover:opacity-10 transition-opacity duration-500`} />
                  
                  <div className="mb-6 flex justify-between items-start">
                    <div className={`w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center border border-white/5 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3`}>
                      <Icon className={`w-7 h-7 text-slate-300 ${tool.hoverColor} transition-colors duration-300`} />
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors duration-300">
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-all duration-300 group-hover:translate-x-0.5" />
                    </div>
                  </div>

                  <h3 className="text-2xl font-semibold text-white mb-3">{tool.name}</h3>
                  <p className="text-slate-400 leading-relaxed flex-1">{tool.description}</p>
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

function AuthGate() {
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
        <FloatingBackground />

        {/* Main content */}
        <div className={`relative z-10 max-w-md w-full transition-all duration-1000 ease-out ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Logo Section */}
          <div className="text-center mb-10">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-indigo-500/30 blur-3xl rounded-full animate-pulse" />
              <img
                src="/elevate-logo.png"
                alt="Elevate Logo"
                className="relative h-40 w-auto object-contain mx-auto mb-6 drop-shadow-2xl animate-fade-in-up"
                style={{ animationDelay: '0.2s' }}
              />
            </div>
            <p
              className="text-xl font-semibold text-white tracking-tight animate-fade-in-up"
              style={{ animationDelay: '0.4s' }}
            >
              Command Center
            </p>
          </div>

          {/* Login Card */}
          <div
            className="relative bg-white/10 backdrop-blur-2xl rounded-3xl p-8 border border-white/20 shadow-2xl animate-fade-in-up overflow-hidden"
            style={{ animationDelay: '0.6s' }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-white/0" />

            <div className="relative">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-semibold text-white mb-2">Welcome Back</h2>
                <p className="text-sm text-slate-300">Sign in with your Gaza Sky Geeks account</p>
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
                  { icon: '🔒', title: 'Unified Access', desc: 'One login for all Elevate apps' },
                  { icon: '🚀', title: 'Quick Launch', desc: 'Seamlessly switch between tools' },
                  { icon: '🛡️', title: 'Secure Gateway', desc: 'Authorized team members only' },
                ].map((feature, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors duration-300"
                  >
                    <span className="text-xl">{feature.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-white">{feature.title}</p>
                      <p className="text-xs text-slate-300">{feature.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Access Notice */}
              <div className="mt-6 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-center">
                <p className="text-xs text-indigo-200 font-medium tracking-wide">
                  RESTRICTED TO @GAZASKYGEEKS.COM
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-8 animate-fade-in-up" style={{ animationDelay: '1s' }}>
            <p className="text-xs text-slate-500">
              Gaza Sky Geeks © 2026 • Elevate Program
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <ToolSelectionPage />;
}

export default function App() {
  return <AuthGate />;
}
