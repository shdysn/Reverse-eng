import React from 'react';
import { CheckCircle2, AlertTriangle, Cpu, Wrench } from 'lucide-react';
import type { HealthData, EditorTab } from '../types/index.js';

interface StatusBarProps {
  health: HealthData | null;
  activeTab: EditorTab | null;
  cursorPos?: { line: number; column: number };
}

export const StatusBar: React.FC<StatusBarProps> = ({ health, activeTab, cursorPos }) => {
  const tools = health?.tools;

  return (
    <footer className="h-6 bg-[#161b22] border-t border-[#30363d] px-3 flex items-center justify-between text-[11px] text-[#8b949e] font-mono select-none shrink-0 z-10">
      {/* Left side: System and Tool Health */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {health?.toolsAvailable ? (
            <span className="flex items-center gap-1 text-[#3fb950]" title="External tools ready">
              <CheckCircle2 className="w-3 h-3" />
              <span>Tools Ready</span>
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-[#d29922]"
              title="External Android CLI tools missing in current sandbox (apktool/java). Codespaces setup script available."
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Preview Mode (CLI Tools Missing)</span>
            </span>
          )}
        </div>

        {/* Detailed tool pill summary */}
        {tools && (
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-[#8b949e]">
            <span className={tools.apktool ? 'text-[#3fb950]' : 'text-[#8b949e]/60'}>
              apktool:{tools.apktool ? 'ok' : 'missing'}
            </span>
            <span>•</span>
            <span className={tools.jadx ? 'text-[#3fb950]' : 'text-[#8b949e]/60'}>
              jadx:{tools.jadx ? 'ok' : 'missing'}
            </span>
            <span>•</span>
            <span className={tools.zipalign ? 'text-[#3fb950]' : 'text-[#8b949e]/60'}>
              zipalign:{tools.zipalign ? 'ok' : 'missing'}
            </span>
            <span>•</span>
            <span className={tools.apksigner ? 'text-[#3fb950]' : 'text-[#8b949e]/60'}>
              apksigner:{tools.apksigner ? 'ok' : 'missing'}
            </span>
          </div>
        )}
      </div>

      {/* Right side: Active File Details */}
      <div className="flex items-center gap-4">
        {activeTab && (
          <>
            {cursorPos && (
              <span className="hidden md:inline">
                Ln {cursorPos.line}, Col {cursorPos.column}
              </span>
            )}
            <span>UTF-8</span>
            <span className="capitalize text-[#c9d1d9]">{activeTab.language}</span>
            <span className="hidden sm:inline">
              {(activeTab.size / 1024).toFixed(1)} KB
            </span>
          </>
        )}
        {!activeTab && <span>No file selected</span>}
      </div>
    </footer>
  );
};
