import React, { useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import {
  FileCode,
  WrapText,
  Info,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  Image as ImageIcon,
} from 'lucide-react';
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
  const [imageZoom, setImageZoom] = useState<number>(100);
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [previewBg, setPreviewBg] = useState<'checker' | 'dark' | 'light'>('checker');

  const handleEditorWillMount = (monaco: Monaco) => {
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
              [/^\s*\.[a-zA-Z0-9_-]+/, 'keyword.directive'],
              [/\b[vp][0-9]+\b/, 'variable.predefined'],
              [/L[a-zA-Z0-9_$/]+;/, 'type'],
              [/#.*$/, 'comment'],
              [/"([^"\\]|\\.)*"/, 'string'],
              [/\b0x[0-9a-fA-F]+\b/, 'number.hex'],
              [/\b[0-9]+\b/, 'number'],
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

    editor.addCommand(2048 | 49, () => {
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
          Select a decompiled Smali, Java, XML, or image asset from the explorer to inspect or edit.
        </p>
        <div className="flex flex-col gap-1.5 text-[11px] font-mono text-[#8b949e]/80 bg-[#161b22] px-4 py-3 rounded border border-[#30363d] text-left">
          <span>• Smali edits belong in: <strong className="text-[#c9d1d9]">decoded/smali/</strong></span>
          <span>• Manifest edits belong in: <strong className="text-[#c9d1d9]">decoded/AndroidManifest.xml</strong></span>
          <span>• Drawables &amp; Icons in <strong className="text-[#c9d1d9]">decoded/res/</strong> open in Visual Asset Previewer</span>
          <span>• Save changes with: <kbd className="px-1 py-0.5 bg-[#21262d] rounded text-[#58a6ff]">Ctrl+S</kbd></span>
        </div>
      </div>
    );
  }

  const isBinaryImage = Boolean(activeTab.isImage && activeTab.language === 'image');

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] overflow-hidden">
      {/* Editor Header / Breadcrumbs */}
      <div className="h-8 bg-[#0d1117] border-b border-[#30363d] px-3 flex items-center justify-between text-xs font-mono select-none shrink-0">
        <div className="flex items-center gap-1.5 text-[#8b949e] truncate">
          <span>workspace</span>
          <span>/</span>
          <span className="text-[#c9d1d9] font-medium truncate">{activeTab.path}</span>
          {isBinaryImage ? (
            <span className="text-[10px] uppercase px-1.5 py-0.2 bg-[#a371f7]/20 text-[#d2a8ff] border border-[#a371f7]/30 rounded ml-2 flex items-center gap-1">
              <ImageIcon className="w-2.5 h-2.5" />
              Image Asset
            </span>
          ) : !activeTab.editable ? (
            <span className="text-[10px] uppercase px-1.5 py-0.2 bg-[#21262d] text-[#8b949e] rounded ml-2">
              Read-Only
            </span>
          ) : null}
          {activeTab.isDirty && (
            <span className="text-[10px] text-[#2f81f7] font-semibold ml-1">● Unsaved</span>
          )}
        </div>

        {/* Workspace controls */}
        <div className="flex items-center gap-2">
          {!isBinaryImage && (
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
          )}
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
      <div className="flex-1 relative overflow-hidden">
        {isLoadingFile ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117] text-[#8b949e] font-mono text-xs">
            Loading file content...
          </div>
        ) : isBinaryImage ? (
          /* Visual Asset & Image Extractor Previewer */
          <div className="flex flex-col h-full w-full bg-[#0d1117] select-none">
            {/* Image Controls Toolbar */}
            <div className="h-10 bg-[#161b22] border-b border-[#30363d] px-4 flex items-center justify-between text-xs font-mono shrink-0">
              <div className="flex items-center gap-3 text-[#8b949e]">
                {imageDimensions && (
                  <span>
                    Dimensions: <strong className="text-[#c9d1d9]">{imageDimensions.w} × {imageDimensions.h} px</strong>
                  </span>
                )}
                <span>
                  Size: <strong className="text-[#c9d1d9]">{(activeTab.size / 1024).toFixed(2)} KB</strong>
                </span>
                {activeTab.mimeType && (
                  <span className="hidden sm:inline text-[#8b949e]/70">({activeTab.mimeType})</span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {/* Background Toggle */}
                <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5 mr-2 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setPreviewBg('checker')}
                    className={`px-1.5 py-0.5 rounded ${
                      previewBg === 'checker' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'
                    }`}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewBg('dark')}
                    className={`px-1.5 py-0.5 rounded ${
                      previewBg === 'dark' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'
                    }`}
                  >
                    Dark
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewBg('light')}
                    className={`px-1.5 py-0.5 rounded ${
                      previewBg === 'light' ? 'bg-[#21262d] text-white' : 'text-[#8b949e]'
                    }`}
                  >
                    Light
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setImageZoom((z) => Math.max(25, z - 25))}
                  className="p-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded border border-[#30363d]"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="w-12 text-center text-[#c9d1d9]">{imageZoom}%</span>
                <button
                  type="button"
                  onClick={() => setImageZoom((z) => Math.min(400, z + 25))}
                  className="p-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded border border-[#30363d]"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setImageZoom(100)}
                  className="p-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] rounded border border-[#30363d]"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                {/* Direct Asset Download Button */}
                <a
                  href={activeTab.content}
                  download={activeTab.name}
                  className="flex items-center gap-1 px-2.5 py-1 bg-[#238636] hover:bg-[#2ea043] text-white rounded text-xs font-sans font-medium ml-2 shadow"
                  title="Extract and download this image asset"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Extract Image</span>
                </a>
              </div>
            </div>

            {/* Image Canvas */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-8">
              <div
                className={`p-6 rounded-lg border border-[#30363d] shadow-2xl flex items-center justify-center transition-all ${
                  previewBg === 'light'
                    ? 'bg-white'
                    : previewBg === 'dark'
                    ? 'bg-[#010409]'
                    : 'bg-[#161b22] [background-image:radial-gradient(#30363d_1px,transparent_1px)] [background-size:12px_12px]'
                }`}
              >
                <img
                  src={activeTab.content}
                  alt={activeTab.name}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                  style={{
                    transform: `scale(${imageZoom / 100})`,
                    transformOrigin: 'center center',
                  }}
                  className="max-w-full max-h-[65vh] object-contain transition-transform duration-150"
                />
              </div>
            </div>
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
