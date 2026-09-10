import { useAppStore } from "../../store/useAppStore";
import { parseISO } from 'date-fns';

export function Timeline({ selectedCorridor }: { selectedCorridor: string | null }) {
  const { corridors, candidateWindows, proposedPlan, baselinePlan } = useAppStore();
  
  const displayCorridors = selectedCorridor 
    ? corridors.filter(c => c.id === selectedCorridor) 
    : corridors;

  const activePlan = proposedPlan || baselinePlan;
  
  // Very simplified timeline calculation for demo
  const getLeftPct = (isoDate: string) => {
    const d = parseISO(isoDate);
    const hours = d.getHours() + d.getMinutes() / 60;
    // Map 0-24h to 0-100%
    return `${(hours / 24) * 100}%`;
  };
  
  const getWidthPct = (durationHours: number) => {
    return `${(durationHours / 24) * 100}%`;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-80">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div>
          <h3 className="font-bold text-slate-800">Weekly Timeline</h3>
          <p className="text-xs text-slate-500">Aug 31 (Demo Day View)</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-slate-200 rounded-sm"></div>
            <span className="text-slate-600">Candidate Window</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-rail-accent rounded-sm"></div>
            <span className="text-slate-600">Proposed Block</span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 relative">
        {/* Time axis */}
        <div className="flex border-b border-slate-200 pb-2 mb-4 text-xs text-slate-400 relative h-6">
          {[0, 4, 8, 12, 16, 20, 24].map(h => (
            <div key={h} className="absolute -translate-x-1/2" style={{ left: `${(h/24)*100}%` }}>
              {h.toString().padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {displayCorridors.map(corridor => {
          const windows = candidateWindows.filter(w => w.corridorId === corridor.id);
          const blocks = activePlan?.assignments.filter(a => a.corridorId === corridor.id) || [];
          
          return (
            <div key={corridor.id} className="mb-6 relative">
              <div className="text-sm font-medium text-slate-700 mb-2 w-32 shrink-0">{corridor.id}</div>
              <div className="h-12 bg-slate-50 border border-slate-200 rounded relative">
                
                {/* Grid lines */}
                {[0, 4, 8, 12, 16, 20].map(h => (
                  <div key={h} className="absolute top-0 bottom-0 border-l border-dashed border-slate-200" style={{ left: `${(h/24)*100}%` }}></div>
                ))}

                {/* Candidate Windows */}
                {windows.map(w => (
                  <div 
                    key={w.id}
                    className="absolute top-1 h-10 bg-slate-200/50 rounded border border-slate-300 border-dashed group"
                    style={{ left: getLeftPct(w.start), width: getWidthPct(w.durationHours) }}
                  >
                    <div className="hidden group-hover:block absolute -top-8 left-0 bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-20">
                      Candidate Window<br/>
                      Derived from timetable gap
                    </div>
                  </div>
                ))}

                {/* Proposed Blocks */}
                {blocks.map(b => (
                  <div 
                    key={b.id}
                    className="absolute top-2 h-8 bg-rail-accent/90 rounded shadow-sm border border-sky-600 flex items-center justify-center cursor-pointer hover:bg-sky-500 transition-colors group z-10"
                    style={{ left: getLeftPct(b.start), width: getWidthPct(b.durationHours) }}
                  >
                    <span className="text-white text-[10px] font-bold px-1 truncate">{b.departments.join('+')}</span>
                    <div className="hidden group-hover:block absolute -top-12 left-0 bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-20">
                      Jobs: {b.jobs.join(', ')}<br/>
                      Requires Validation
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
