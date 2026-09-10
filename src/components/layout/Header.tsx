import { Bell, UserCircle } from 'lucide-react';

export function Header() {
  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Planning Horizon</span>
          <span className="text-sm font-medium bg-slate-100 px-2 py-1 rounded">Weekly</span>
        </div>
        <div className="h-4 w-px bg-slate-300"></div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Selected Division</span>
          <span className="text-sm font-medium">Alpha Division (Demo)</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 rounded-full border border-amber-200">
          <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
          <span className="text-xs font-medium text-amber-700">Synthetic Data Mode</span>
        </div>
        <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
          <Bell className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
          <div className="text-right">
            <p className="text-sm font-medium text-slate-900">Controller (Demo)</p>
            <p className="text-xs text-slate-500">Operations</p>
          </div>
          <UserCircle className="h-8 w-8 text-slate-400" />
        </div>
      </div>
    </header>
  );
}
