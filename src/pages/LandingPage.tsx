import { Link } from 'react-router-dom';
import { Activity, ArrowRight, ShieldCheck, Clock, Layers } from 'lucide-react';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="px-8 py-6 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Activity className="h-8 w-8 text-rail-accent" />
          <span className="text-xl font-bold tracking-wider">SANGAM</span>
        </div>
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="px-3 py-1 bg-slate-800 rounded-full text-slate-300">SIH 2026 Prototype</span>
          <span className="px-3 py-1 bg-slate-800 rounded-full text-slate-300">Problem 26027</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 max-w-4xl mx-auto w-full">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6">
          Smart Allocation & Network Governance <br className="hidden md:block"/> for Asset Maintenance
        </h1>
        <p className="text-xl text-slate-400 mb-10 max-w-3xl leading-relaxed">
          Coordinate maintenance demand across ENGG, TRD and S&T with corridor and timetable context to generate optimized maintenance plans.
        </p>

        <div className="flex items-center gap-4 mb-16">
          <Link 
            to="/dashboard" 
            className="flex items-center gap-2 bg-rail-accent hover:bg-sky-500 text-white px-8 py-4 rounded-lg font-semibold transition-all text-lg"
          >
            Open Planning Dashboard
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>

        <div className="w-full bg-slate-800/50 rounded-2xl p-8 border border-slate-700 backdrop-blur-sm">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500 mb-8">Demo Scenario Pipeline</h2>
          
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-center p-4">
              <div className="bg-slate-800 h-16 w-16 rounded-xl flex items-center justify-center mx-auto mb-4 border border-slate-600">
                <Layers className="h-8 w-8 text-slate-300" />
              </div>
              <h3 className="font-semibold text-slate-200">TMS/SMMS/TDMS</h3>
              <p className="text-xs text-slate-500 mt-1">Synthetic Demand</p>
            </div>
            
            <div className="hidden md:block h-px flex-1 bg-gradient-to-r from-transparent via-rail-accent to-transparent"></div>
            
            <div className="text-center p-4">
              <div className="bg-slate-800 h-16 w-16 rounded-xl flex items-center justify-center mx-auto mb-4 border border-slate-600">
                <Clock className="h-8 w-8 text-slate-300" />
              </div>
              <h3 className="font-semibold text-slate-200">Feasible Windows</h3>
              <p className="text-xs text-slate-500 mt-1">Timetable Context</p>
            </div>

            <div className="hidden md:block h-px flex-1 bg-gradient-to-r from-transparent via-rail-accent to-transparent"></div>

            <div className="text-center p-4">
              <div className="bg-slate-800 h-16 w-16 rounded-xl flex items-center justify-center mx-auto mb-4 border border-slate-600">
                <ShieldCheck className="h-8 w-8 text-slate-300" />
              </div>
              <h3 className="font-semibold text-slate-200">Weekly Plan</h3>
              <p className="text-xs text-slate-500 mt-1">Controller Review</p>
            </div>
          </div>
        </div>

      </main>
      <footer className="py-6 text-center text-slate-600 text-sm">
        <p>This is a decision-support prototype. It does not replace operational authority or safety constraints.</p>
      </footer>
    </div>
  );
}
