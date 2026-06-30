import React, { useState } from 'react';
import { Folder, FolderOpen, FileCode, ChevronDown, ChevronRight } from 'lucide-react';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  children?: FileNode[];
}

interface FileTreeProps {
  node: FileNode;
  onFileSelect: (path: string) => void;
  selectedFile?: string;
}

export const FileTree: React.FC<FileTreeProps> = ({ node, onFileSelect, selectedFile }) => {
  const [isOpen, setIsOpen] = useState<boolean>(true);

  const toggleOpen = () => {
    if (node.type === 'directory') {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'file' && node.path) {
      onFileSelect(node.path);
    } else {
      toggleOpen();
    }
  };

  const isSelected = node.type === 'file' && selectedFile === node.path;

  if (node.type === 'file') {
    return (
      <div
        onClick={handleSelect}
        className={`flex items-center gap-2 py-1.5 px-3 rounded-md cursor-pointer transition-all duration-150 text-sm ${
          isSelected
            ? 'bg-indigo-500/20 text-indigo-300 border-l-2 border-indigo-500 pl-2'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
        }`}
      >
        <FileCode size={16} className={isSelected ? 'text-indigo-400' : 'text-slate-500'} />
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        onClick={handleSelect}
        className="flex items-center justify-between py-1.5 px-3 rounded-md cursor-pointer hover:bg-slate-800/40 transition-all text-slate-300 hover:text-slate-100 text-sm"
      >
        <div className="flex items-center gap-2 truncate">
          {isOpen ? (
            <FolderOpen size={16} className="text-amber-500 shrink-0" />
          ) : (
            <Folder size={16} className="text-amber-600 shrink-0" />
          )}
          <span className="truncate font-medium">{node.name}</span>
        </div>
        {node.children && node.children.length > 0 && (
          <span className="text-slate-500">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
      </div>
      
      {isOpen && node.children && (
        <div className="pl-4 border-l border-slate-800/80 ml-4 mt-0.5 space-y-0.5">
          {node.children.map((child, idx) => (
            <FileTree
              key={idx}
              node={child}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};
export default FileTree;
