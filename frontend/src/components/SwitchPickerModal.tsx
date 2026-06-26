// Switch Picker modal — small list-modal shown when a tool needs the
// operator to pick a switch (e.g. "show clock on switch …"). Returns
// the chosen switch (ip + name) via the parent-provided callback.
//
// Pure presentational: parent owns the open flag, title, switch list,
// and the picked callback.
//
// Extracted from App.tsx.

export interface SwitchOption {
  ip: string;
  name?: string | null;
}

export interface SwitchPickerModalProps {
  open: boolean;
  title: string;
  switches: SwitchOption[];
  onPick: (ip: string, name: string) => void;
  onClose: () => void;
}

export function SwitchPickerModal({ open, title, switches, onPick, onClose }: SwitchPickerModalProps) {
  if (!open) return null;
  return (
    <div className="w-full max-w-2xl bg-slate-800 rounded-xl shadow-xl overflow-hidden border border-slate-700">
      <div className="bg-indigo-300/10 px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <h2 className="text-slate-200 text-lg font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg p-2 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
        {switches.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-8">No switches available. Load inventory first.</div>
        ) : (
          switches.map((sw) => (
            <button
              key={sw.ip}
              onClick={() => onPick(sw.ip, sw.name || "")}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-slate-900/50 border border-slate-700 hover:bg-slate-900/70 hover:border-slate-600 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-slate-200 font-medium text-sm">{sw.name || sw.ip}</span>
                {sw.name && <code className="text-slate-400 text-xs font-mono">{sw.ip}</code>}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
