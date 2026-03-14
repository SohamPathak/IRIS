import { useState } from 'react';

const IRIS_COLORS = ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe'];

function IrisLogo({ animate }) {
  return (
    <div className={`relative w-24 h-24 mx-auto mb-6 ${animate ? 'animate-pulse-slow' : ''}`}>
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
        {/* Outer ring */}
        <circle cx="50" cy="50" r="46" fill="none" stroke={IRIS_COLORS[3]} strokeWidth="2" className="animate-spin-slow" style={{ transformOrigin: 'center' }} />
        {/* Iris petals */}
        {[0, 60, 120, 180, 240, 300].map((angle, i) => (
          <ellipse
            key={i}
            cx="50" cy="50"
            rx="18" ry="38"
            fill="none"
            stroke={IRIS_COLORS[i % IRIS_COLORS.length]}
            strokeWidth="1.5"
            opacity="0.6"
            transform={`rotate(${angle} 50 50)`}
            className="animate-breathe"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
        {/* Inner circle — pupil */}
        <circle cx="50" cy="50" r="12" fill="url(#irisGrad)" className="animate-breathe" />
        {/* Highlight */}
        <circle cx="44" cy="44" r="4" fill="white" opacity="0.7" />
        <defs>
          <radialGradient id="irisGrad" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#312e81" />
            <stop offset="100%" stopColor="#4f46e5" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('merchant@iris.local');
  const [password, setPassword] = useState('••••••••');
  const [loading, setLoading] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    // Fake login delay with animation
    setTimeout(() => {
      setFadeOut(true);
      setTimeout(() => onLogin(), 600);
    }, 1200);
  }

  return (
    <div className={`min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-900 transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-indigo-400/10 animate-float"
            style={{
              width: `${8 + Math.random() * 20}px`,
              height: `${8 + Math.random() * 20}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDuration: `${6 + Math.random() * 8}s`,
              animationDelay: `${Math.random() * 5}s`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-8">
          <IrisLogo animate={loading} />

          <h1 className="text-2xl font-bold text-white text-center tracking-tight">
            Iris
          </h1>
          <p className="text-indigo-300 text-center text-sm mt-1 mb-8">
            Merchant Lifecycle Management
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-indigo-300 mb-1.5">Email</label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/10 border border-white/15 rounded-xl text-white text-sm placeholder-indigo-400/50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-indigo-300 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-white/10 border border-white/15 rounded-xl text-white text-sm placeholder-indigo-400/50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-all duration-200 disabled:opacity-70 relative overflow-hidden group"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                <>
                  <span className="relative z-10">Sign In</span>
                  <div className="absolute inset-0 bg-indigo-400/20 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-indigo-400/50 text-xs mt-6">
            Demo mode — any credentials work
          </p>
        </div>

        <p className="text-center text-indigo-500/40 text-xs mt-4">
          Powered by AWS Bedrock & Pine Labs
        </p>
      </div>
    </div>
  );
}
