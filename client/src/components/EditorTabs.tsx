import React from 'react';
import { X, Circle, MoreHorizontal } from 'lucide-react';
import type { EditorTab } from '../types/index.js';

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseAll: () => void;
}

export const EditorTabs: React.FC<EditorTabsProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
}) => {
  if (tabs.length === 0) return null;

  return (
    <div className="h-9 bg-[#161b22] border-b border-[#30363d] flex items-center justify-between select-none overflow-hidden shrink-0">
      {/* Scrollable Tabs Container */}
      <div className="flex items-center overflow-x-auto scrollbar-none h-full">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex items-center gap-2 h-full px-3 text-xs font-mono border-r border-[#30363d] cursor-pointer transition-colors shrink-0 max-w-[200px] ${
                isActive
                  ? 'bg-[#0d1117] text-[#c9d1d9] border-t-2 border-t-[#2f81f7]'
                  : 'bg-[#161b22] text-[#8b949e] hover:bg-[#21262d] hover:text-[#c9d1d9]'
              }`}
            >
              <span className="truncate">{tab.name}</span>

              {/* Dirty indicator or close button */}
              <div className="flex items-center shrink-0">
                {tab.isDirty ? (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    className="p-0.5 rounded hover:bg-[#30363d] text-[#2f81f7] group-hover:hidden"
                    title="Unsaved changes"
                  >
                    <Circle className="w-2.5 h-2.5 fill-current" />
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`p-0.5 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-white ${
                    tab.isDirty ? 'hidden group-hover:block' : ''
                  }`}
                  title="Close Tab"
                  aria-label={`Close ${tab.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tab Overflow Actions */}
      <div className="flex items-center px-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            if (activeTabId) onCloseOthers(activeTabId);
          }}
          className="text-[11px] text-[#8b949e] hover:text-[#c9d1d9] px-2 py-1 rounded hover:bg-[#21262d] hidden sm:block"
          title="Close Other Tabs"
        >
          Close Others
        </button>
        <button
          type="button"
          onClick={onCloseAll}
          className="text-[11px] text-[#8b949e] hover:text-[#f85149] px-2 py-1 rounded hover:bg-[#21262d]"
          title="Close All Tabs"
        >
          Close All
        </button>
      </div>
    </div>
  );
};
