import React, { useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import { FileCode, WrapText, Save, Info, AlertCircle } from 'lucide-react';
import type { EditorTab } from '../types/index.js';

interface CodeWorkspaceProps {
  activeTab: EditorTab | null;
  isLoadingFile: boolean;
  onContentChange: (newContent: string) => void;
  onSave: () => void;
  onCursorChange?: (line: number, column: number) => void;
}

export const CodeWorkspace: React.FC<CodeWorkspaceProps> = ({
  activeTab,
  isLoadingFile,
  onContentChange,
  onSave,
  onCursorChange,
}) => {
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');

  const handleEditorWillMount = (monaco: Monaco) => {
    // Register Smali custom language if not already registered
    try {
      const languages = monaco.languages.getLanguages();
      if (!languages.some((lang: { id: string }) => lang.id === 'smali')) {
        monaco.languages.register({ id: 'smali' });
        monaco.languages.setMonarchTokensProvider('smali', {
          defaultToken: '',
          tokenPostfix: '.smali',
          keywords: [
            'goto', 'return', 'return-void', 'return-object', 'const', 'const-string',
            'const-class', 'new-instance', 'check-cast', 'instance-of', 'array-length',
            'new-array', 'fill-array-data', 'throw', 'monitor-enter', 'monitor-exit',
            'move', 'move-result', 'move-exception', 'invoke-virtual', 'invoke-super',
            'invoke-direct', 'invoke-static', 'invoke-interface', 'if-eq', 'if-ne',
            'if-lt', 'if-ge', 'if-gt', 'if-le', 'if-eqz', 'if-nez', 'sget', 'sput',
            'iget', 'iput', 'nop'
          ],
          tokenizer: {
            root: [
              // Directives beginning with a dot
              [/^\s*\.[a-zA-Z0-9_-]+/, 'keyword.directive'],
              // Registers like v0, v1, p0, p1
              [/\b[vp][0-9]+\b/, 'variable.predefined'],
              // Class descriptors like Ljava/lang/String;
              [/L[a-zA-Z0-9_$/]+;/, 'type'],
              // Comments starting with #
              [/#.*$/, 'comment'],
              // Strings
              [/"([^"\\]|\\.)*"/, 'string'],
              // Numbers & Hex
              [/\b0x[0-9a-fA-F]+\b/, 'number.hex'],
              [/\b[0-9]+\b/, 'number'],
              // Standard instructions
              [/[a-zA-Z0-9_-]+(?=\s)/, {
                cases: {
                  '@keywords': 'keyword',
                  '@default': 'identifier',
                },
              }],
            ],
          },
        });
      }
    } catch (e) {
      console.warn('Smali Monaco language registration fallback:', e);
    }
  };

  const handleEditorDidMount = (editor: any) => {
    editor.onDidChangeCursorPosition((e: any) => {
      if (onCursorChange) {
        onCursorChange(e.position.lineNumber, e.position.column);
      }
    });

    // Handle Ctrl+S / Cmd+S in Monaco editor context
    editor.addCommand(2048 | 49, () => { // KeyMod.CtrlCmd | KeyCode.KeyS
      onSave();
    });
  };

  if (!activeTab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0d1117] text-[#8b949e] p-6 text-center select-none">
        <div className="w-16 h-16 rounded-2xl bg-[#161b22] border border-[#30363d] flex items-center justify-center text-[#2f81f7] mb-4 shadow-lg">
          <FileCode className="w-8 h-8" />
        </div>
        <h3 className="text-base font-semibold text-[#c9d1d9] mb-1">Android Analysis Workspace</h3>
        <p className="text-xs max-w-md text-[#8b949e] mb-4">
          Select a decompiled Smali, Java, XML, or resource file from the explorer to inspect or edit.
        </p>
        <div className="flex flex-col gap-1.5 text-[11px] font-mono text-[#8b949e]/80 bg-[#161b22] px-4 py-3 rounded border border-[#30363d] text-left">
          <span>• Smali edits belong in: <strong className="text-[#c9d1d9]">decoded/smali/</strong></span>
          <span>• Manifest edits belong in: <strong className="text-[#c9d1d9]">decoded/AndroidManifest.xml</strong></span>
          <span>• Java output in <strong className="text-[#c9d1d9]">java/</strong> is informational from JADX</span>
          <span>• Save changes with: <kbd className="px-1 py-0.5 bg-[#21262d] rounded text-[#58a6ff]">Ctrl+S</kbd></span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] overflow-hidden">
      {/* Editor Header / Breadcrumbs */}
      <div className="h-8 bg-[#0d1117] border-b border-[#30363d] px-3 flex items-center justify-between text-xs font-mono select-none shrink-0">
        <div className="flex items-center gap-1.5 text-[#8b949e] truncate">
          <span>workspace</span>
          <span>/</span>
          <span className="text-[#c9d1d9] font-medium truncate">{activeTab.path}</span>
          {!activeTab.editable && (
            <span className="text-[10px] uppercase px-1.5 py-0.2 bg-[#21262d] text-[#8b949e] rounded ml-2">
              Read-Only
            </span>
          )}
          {activeTab.isDirty && (
            <span className="text-[10px] text-[#2f81f7] font-semibold ml-1">● Unsaved</span>
          )}
        </div>

        {/* Workspace controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWordWrap((prev) => (prev === 'on' ? 'off' : 'on'))}
            className={`p-1 rounded transition-colors ${
              wordWrap === 'on' ? 'bg-[#21262d] text-[#58a6ff]' : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
            title="Toggle Word Wrap"
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Rebuild Notice banner for Java files */}
      {activeTab.path.startsWith('java/') && (
        <div className="bg-[#161b22] border-b border-[#30363d] px-3 py-1 flex items-center gap-2 text-[11px] text-[#d29922]">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>
            JADX Java output is informational. Changes here do not affect the rebuilt APK (edit Smali bytecode in decoded/smali instead).
          </span>
        </div>
      )}

      {/* Editor Content Area */}
      <div className="flex-1 relative">
        {isLoadingFile ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] text-[#8b949e] font-mono text-xs">
            Loading file content...
          </div>
        ) : (
          <Editor
            theme="vs-dark"
            language={activeTab.language === 'smali' ? 'smali' : activeTab.language}
            value={activeTab.content}
            beforeMount={handleEditorWillMount}
            onMount={handleEditorDidMount}
            onChange={(val) => onContentChange(val || '')}
            options={{
              readOnly: !activeTab.editable,
              automaticLayout: true,
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, monospace",
              minimap: { enabled: true, maxColumn: 80 },
              lineNumbers: 'on',
              folding: true,
              bracketPairColorization: { enabled: true },
              wordWrap,
              scrollBeyondLastLine: false,
              renderWhitespace: 'selection',
              smoothScrolling: true,
            }}
          />
        )}
      </div>
    </div>
  );
};
