import { useAppStore } from "../../store/useAppStore";

export function NetworkMap({ selectedCorridor, onSelectCorridor }: { selectedCorridor: string | null, onSelectCorridor: (id: string) => void }) {
  const { topology } = useAppStore();

  if (!topology) return null;

  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden h-64 flex flex-col">
      <div className="flex justify-between items-center mb-2 z-10">
        <h3 className="font-bold text-slate-800">Schematic Network</h3>
        <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded">Schematic demo</span>
      </div>
      
      <div className="flex-1 relative border border-dashed border-slate-300 bg-slate-50 rounded flex items-center justify-center p-8">
        
        {/* A simple hardcoded SVG representation of the mock topology for the demo */}
        <svg viewBox="0 0 500 200" className="w-full h-full max-w-lg overflow-visible">
          {/* Corridors */}
          <line x1="50" y1="100" x2="200" y2="100" 
                stroke={selectedCorridor === "COR-A-B" ? "#0284c7" : "#cbd5e1"} 
                strokeWidth={selectedCorridor === "COR-A-B" ? 8 : 4} 
                className="transition-all cursor-pointer hover:stroke-sky-400"
                onClick={() => onSelectCorridor("COR-A-B")} />
          
          <line x1="200" y1="100" x2="400" y2="100" 
                stroke={selectedCorridor === "COR-B-C" ? "#0284c7" : "#cbd5e1"} 
                strokeWidth={selectedCorridor === "COR-B-C" ? 8 : 4} 
                className="transition-all cursor-pointer hover:stroke-sky-400"
                onClick={() => onSelectCorridor("COR-B-C")} />
                
          <line x1="200" y1="100" x2="300" y2="170" 
                stroke={selectedCorridor === "COR-B-D" ? "#0284c7" : "#cbd5e1"} 
                strokeWidth={selectedCorridor === "COR-B-D" ? 8 : 4} 
                className="transition-all cursor-pointer hover:stroke-sky-400"
                onClick={() => onSelectCorridor("COR-B-D")} />

          {/* Stations */}
          <circle cx="50" cy="100" r="8" fill="#1e293b" />
          <text x="50" y="80" textAnchor="middle" className="text-xs fill-slate-700 font-medium">STN-A</text>
          
          <circle cx="200" cy="100" r="8" fill="#1e293b" />
          <text x="200" y="80" textAnchor="middle" className="text-xs fill-slate-700 font-medium">STN-B (JNC)</text>
          
          <circle cx="400" cy="100" r="8" fill="#1e293b" />
          <text x="400" y="80" textAnchor="middle" className="text-xs fill-slate-700 font-medium">STN-C</text>
          
          <circle cx="300" cy="170" r="8" fill="#1e293b" />
          <text x="300" y="195" textAnchor="middle" className="text-xs fill-slate-700 font-medium">STN-D</text>

          {/* Crossovers (Demo visual) */}
          <rect x="120" y="95" width="10" height="10" fill="#f59e0b" />
          <text x="125" y="120" textAnchor="middle" className="text-[10px] fill-amber-700">X-1</text>
        </svg>

      </div>
    </div>
  );
}
