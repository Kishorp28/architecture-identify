import React, { useEffect, useRef } from 'react';
import { Copy, Check, FileText } from 'lucide-react';

interface CodeViewerProps {
  fileName: string;
  code: string;
  highlightRange?: { start: number; end: number };
}

export const CodeViewer: React.FC<CodeViewerProps> = ({ fileName, code, highlightRange }) => {
  const [copied, setCopied] = React.useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');

  useEffect(() => {
    if (highlightRange && lineRefs.current[highlightRange.start]) {
      // Small timeout to allow render completion
      setTimeout(() => {
        lineRefs.current[highlightRange.start]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 200);
    }
  }, [highlightRange, code]);

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-lg border border-slate-800 overflow-hidden font-mono text-sm shadow-xl">
      {/* Code Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-slate-800">
        <div className="flex items-center gap-2 text-slate-300">
          <FileText size={16} className="text-indigo-400" />
          <span className="font-semibold text-xs text-slate-400 truncate max-w-xs md:max-w-md">{fileName}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/80 rounded transition-all duration-150"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-500" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto p-4 leading-6 text-slate-300 bg-[#0d1117]"
      >
        <div className="min-w-full table">
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const isHighlighted = highlightRange 
              ? lineNum >= highlightRange.start && lineNum <= highlightRange.end 
              : false;

            return (
              <div
                key={idx}
                ref={el => { lineRefs.current[lineNum] = el; }}
                className={`table-row ${
                  isHighlighted 
                    ? 'bg-indigo-500/10 border-l-4 border-indigo-500 -ml-1 pl-1' 
                    : 'hover:bg-slate-800/10'
                }`}
              >
                {/* Line Number Column */}
                <div 
                  className={`table-cell pr-4 select-none text-right w-10 text-xs border-r border-slate-800/60 ${
                    isHighlighted ? 'text-indigo-400 font-bold' : 'text-slate-600'
                  }`}
                >
                  {lineNum}
                </div>
                {/* Code Line Column */}
                <pre className={`table-cell pl-4 whitespace-pre text-xs ${
                  isHighlighted ? 'text-slate-100 font-medium' : 'text-slate-300'
                }`}>
                  {line || ' '}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
export default CodeViewer;
