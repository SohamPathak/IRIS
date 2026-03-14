import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/bids', label: 'Bids', icon: '🤝' },
  { to: '/inventory', label: 'Inventory', icon: '📦' },
  { to: '/accounts', label: 'Accounts', icon: '🏦' },
  { to: '/invoices', label: 'Invoices', icon: '📄' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/disputes', label: 'Disputes', icon: '⚖️' },
  { to: '/treasury', label: 'Treasury', icon: '💰' },
  { to: '/action-log', label: 'Action Log', icon: '📋' },
  { to: '/policies', label: 'Policy Editor', icon: '⚙️' },
];

export default function Layout({ onLogout }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 bg-gray-900 text-white flex flex-col flex-shrink-0">
        <div className="px-6 py-5 border-b border-gray-700">
          <h1 className="text-xl font-bold tracking-tight">🔮 Iris</h1>
          <p className="text-xs text-gray-400 mt-1">Merchant Lifecycle Management</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-500">Iris v0.2</span>
          {onLogout && (
            <button onClick={onLogout} className="text-xs text-gray-400 hover:text-white transition-colors">
              Sign Out →
            </button>
          )}
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
