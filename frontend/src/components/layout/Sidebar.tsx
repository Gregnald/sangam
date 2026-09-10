import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Wrench, Calendar, BarChart3, Activity, CalendarDays } from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Maintenance', href: '/maintenance', icon: Wrench },
  { name: 'Block Planner', href: '/planner', icon: Calendar },
  { name: 'Monthly Plan', href: '/monthly', icon: CalendarDays },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <div className="w-64 bg-rail-dark text-slate-300 flex flex-col h-full border-r border-slate-700">
      <div className="p-6">
        <Link to="/" className="flex items-center gap-3">
          <Activity className="h-8 w-8 text-rail-accent" />
          <div>
            <h1 className="text-xl font-bold text-white tracking-wider">SANGAM</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">Hackathon Prototype</p>
          </div>
        </Link>
      </div>
      
      <nav className="flex-1 px-4 space-y-2 mt-4">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <Link
              key={item.name}
              to={item.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors",
                isActive 
                  ? "bg-rail-accent/20 text-white font-medium" 
                  : "hover:bg-slate-800 hover:text-white"
              )}
            >
              <item.icon className={clsx("h-5 w-5", isActive ? "text-rail-accent" : "text-slate-400")} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800 rounded p-3 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400">System Status</span>
            <span className="flex h-2 w-2 rounded-full bg-green-500"></span>
          </div>
          <p className="text-slate-300">Demo Environment</p>
        </div>
      </div>
    </div>
  );
}
