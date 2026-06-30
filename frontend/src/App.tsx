import { useState, useEffect } from 'react';
import { 
  Terminal, Code2, RefreshCw, BookOpen, 
  GitFork, FolderOpen, ArrowRight, Play, CheckCircle2,
  FileCode, Layers, Server, Database, ChevronRight,
  MessageSquare, Sparkles, Send, Copy, Check, Info, AlertTriangle
} from 'lucide-react';

import FileTree from './components/FileTree';
import CodeViewer from './components/CodeViewer';
import ArchitectureGraph from './components/ArchitectureGraph';

interface LanguageInfo {
  language: string;
  count: number;
  percentage: number;
}

interface ApiEndpoint {
  method: string;
  path: string;
  file: string;
  handler?: string;
  line: number;
}

interface DbModel {
  name: string;
  fields: string[];
  file: string;
  line: number;
}

interface ImportEdge {
  from: string;
  import: string;
}

interface ArchitectureData {
  repo_name: string;
  folder_tree: any;
  languages: LanguageInfo[];
  api_endpoints: ApiEndpoint[];
  db_models: DbModel[];
  imports: ImportEdge[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
}

interface SmellsData {
  large_files: Array<{ file_path: string; lines: number }>;
  long_functions: Array<{ file_path: string; function_name: string; lines: number; range: string }>;
  circular_dependencies: string[][];
}

interface RefactorIssue {
  type: string;
  severity: string;
  description: string;
  lines: string;
  original_code: string;
  suggested_refactor: string;
}

interface RefactorAdvice {
  overall_summary: string;
  issues: RefactorIssue[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'chat' | 'refactoring' | 'documentation'>('dashboard');
  
  // Indexing State
  const [pathOrUrl, setPathOrUrl] = useState<string>('');
  const [indexStatus, setIndexStatus] = useState<'idle' | 'indexing' | 'ready' | 'error'>('idle');
  const [repoInfo, setRepoInfo] = useState<any>({ repo_name: '', file_count: 0, error_message: '' });
  const [loadingIndex, setLoadingIndex] = useState<boolean>(false);

  // Backend health indicator
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null); // null = unknown
  
  // Scanned Repo Metadata
  const [archData, setArchData] = useState<ArchitectureData | null>(null);
  
  // File Viewer Drawer State
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [highlightRange, setHighlightRange] = useState<{ start: number; end: number } | undefined>(undefined);
  const [isViewerOpen, setIsViewerOpen] = useState<boolean>(false);
  
  // Chat State
  const [chatQuestion, setChatQuestion] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState<boolean>(false);
  
  // Refactoring State
  const [smells, setSmells] = useState<SmellsData | null>(null);
  const [activeRefactorFile, setActiveRefactorFile] = useState<string>('');
  const [refactorAdvice, setRefactorAdvice] = useState<RefactorAdvice | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState<boolean>(false);
  const [copiedBlockIdx, setCopiedBlockIdx] = useState<number | null>(null);
  
  // Documentation State
  const [docMarkdown, setDocMarkdown] = useState<string>('');
  const [loadingDocs, setLoadingDocs] = useState<boolean>(false);
  const [copiedDocs, setCopiedDocs] = useState<boolean>(false);

  // Live progress during indexing
  const [progressPct, setProgressPct] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<string>('Starting...');

  // Poll backend health every 3 s so the header dot stays accurate
  useEffect(() => {
    checkStatus();
    const healthInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        setBackendOnline(res.ok);
      } catch {
        setBackendOnline(false);
      }
    }, 3000);
    return () => clearInterval(healthInterval);
  }, []);

  const fetchJson = async (url: string, options?: RequestInit) => {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`Server returned ${res.status} (${res.statusText})`);
    }
    return res.json();
  };

  const checkStatus = async () => {
    try {
      const data = await fetchJson('/api/status');
      setBackendOnline(true);
      setIndexStatus(data.status);
      setRepoInfo(data);
      
      if (data.status === 'ready') {
        fetchArchitecture();
        fetchSmells();
      }
    } catch (e) {
      setBackendOnline(false);
      console.error("Failed to fetch status:", e);
    }
  };

  const startIndexing = async () => {
    if (!pathOrUrl.trim()) {
      setIndexStatus('error');
      setRepoInfo({ error_message: 'Please enter a valid local folder path or git repository URL.' });
      return;
    }
    setLoadingIndex(true);
    setRepoInfo({ repo_name: '', file_count: 0, error_message: '' });
    try {
      await fetchJson('/api/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path_or_url: pathOrUrl }),
      });
      setBackendOnline(true);
      setIndexStatus('indexing');
      setProgressPct(0);
      setProgressStep('Cloning repository...');

      // Track consecutive poll failures — if backend goes away during indexing,
      // reset state so the scan form reappears instead of staying stuck.
      let pollFailures = 0;

      // Poll progress every 800 ms for snappy live updates
      const progressInterval = setInterval(async () => {
        try {
          const prog = await fetchJson('/api/progress');
          setProgressPct(prog.pct ?? 0);
          setProgressStep(prog.step || 'Working...');
        } catch (_) { /* backend may briefly not respond */ }
      }, 800);
      
      // Poll status every 2 s to detect completion / error
      const interval = setInterval(async () => {
        try {
          const checkData = await fetchJson('/api/status');
          pollFailures = 0; // reset on success
          setBackendOnline(true);
          setIndexStatus(checkData.status);
          setRepoInfo(checkData);
          
          if (checkData.status === 'ready' || checkData.status === 'error') {
            clearInterval(interval);
            clearInterval(progressInterval);
            setLoadingIndex(false);
            if (checkData.status === 'ready') {
              setProgressPct(100);
              fetchArchitecture();
              fetchSmells();
              setChatMessages([
                { 
                  role: 'assistant', 
                  content: `Hi! I have successfully indexed the **${checkData.repo_name}** repository. I've analyzed its structure, dependencies, APIs, and data models. Ask me anything about how the project works, or head over to the **Architecture** or **Refactoring** tabs to inspect diagrams and find code smells!` 
                }
              ]);
            }
          }
        } catch (pollError) {
          pollFailures++;
          console.error("Error polling index status:", pollError);
          // After 4 consecutive failures the backend is gone — unblock the UI
          if (pollFailures >= 4) {
            clearInterval(interval);
            clearInterval(progressInterval);
            setIndexStatus('error');
            setLoadingIndex(false);
            setBackendOnline(false);
            setRepoInfo({ error_message: 'Backend stopped responding. Make sure the server is running on port 8000.' });
          }
        }
      }, 2000);
      
    } catch (e: any) {
      setIndexStatus('error');
      setLoadingIndex(false);
      const isOffline = e.message?.includes('502') || e.message?.includes('fetch') || e.message?.includes('Failed to fetch');
      if (isOffline) {
        setBackendOnline(false);
      }
      setRepoInfo({ error_message: isOffline
        ? 'Cannot reach backend. Run: .\\backend\\venv\\Scripts\\python run.py  (from E:\\ai\\rag)'
        : (e.message || 'Unknown error') });
    }
  };

  const fetchArchitecture = async () => {
    try {
      const data = await fetchJson('/api/architecture');
      setArchData(data);
    } catch (e) {
      console.error("Failed to fetch architecture data:", e);
    }
  };

  const fetchSmells = async () => {
    try {
      const data = await fetchJson('/api/refactor/smells');
      setSmells(data);
    } catch (e) {
      console.error("Failed to fetch smells:", e);
    }
  };

  const selectFile = async (path: string, range?: { start: number; end: number }) => {
    setSelectedFile(path);
    setHighlightRange(range);
    setIsViewerOpen(true);
    try {
      const data = await fetchJson(`/api/file-content?file_path=${encodeURIComponent(path)}`);
      setFileContent(data.content);
    } catch (e) {
      setFileContent(`Error loading file: ${e}`);
    }
  };

  const sendChatMessage = async () => {
    if (!chatQuestion.trim() || loadingChat) return;
    const userMsg = chatQuestion;
    setChatQuestion('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoadingChat(true);

    try {
      const data = await fetchJson('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMsg }),
      });
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources }]);
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error querying LLM: ${e}` }]);
    } finally {
      setLoadingChat(false);
    }
  };

  const fetchRefactorAdvice = async (path: string) => {
    setActiveRefactorFile(path);
    setLoadingAdvice(true);
    setRefactorAdvice(null);
    try {
      const data = await fetchJson(`/api/refactor/advice?file_path=${encodeURIComponent(path)}`);
      setRefactorAdvice(data);
    } catch (e) {
      console.error("Failed to fetch refactor advice:", e);
    } finally {
      setLoadingAdvice(false);
    }
  };

  const generateDocs = async () => {
    setLoadingDocs(true);
    try {
      const data = await fetchJson('/api/generate-docs', { method: 'POST' });
      setDocMarkdown(data.markdown);
    } catch (e) {
      setDocMarkdown(`Failed to generate docs: ${e}`);
    } finally {
      setLoadingDocs(false);
    }
  };


  const copyDocsToClipboard = () => {
    navigator.clipboard.writeText(docMarkdown);
    setCopiedDocs(true);
    setTimeout(() => setCopiedDocs(false), 2000);
  };

  const copyRefactoredCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedBlockIdx(idx);
    setTimeout(() => setCopiedBlockIdx(null), 2000);
  };

  // Convert raw node trees and graph lists for ArchitectureGraph component
  const getGraphData = () => {
    if (!archData) return { nodes: [], links: [] };

    const nodes: any[] = [];
    const links: any[] = [];
    const addedNodes = new Set<string>();

    if (activeTab === 'dashboard') {
      // 1. Dependencies Graph Visualizer
      archData.imports.forEach(edge => {
        // Node: Edge 'from'
        const fromName = edge.from.split('/').pop() || edge.from;
        if (!addedNodes.has(edge.from)) {
          addedNodes.add(edge.from);
          nodes.push({ id: edge.from, name: fromName, type: 'file', details: `Imports local modules. File: ${edge.from}` });
        }

        // Try to match import string to a known node path
        const matchedTarget = archData.imports.find(i => i.from.includes(edge.import))?.from || edge.import;
        const targetName = matchedTarget.split('/').pop() || matchedTarget;

        if (!addedNodes.has(matchedTarget)) {
          addedNodes.add(matchedTarget);
          nodes.push({ id: matchedTarget, name: targetName, type: 'file', details: `Imported module: ${matchedTarget}` });
        }

        links.push({ source: edge.from, target: matchedTarget, type: 'import' });
      });

      // If no modules index dependencies, visualize folder tree structure
      if (nodes.length === 0 && archData.folder_tree) {
        const buildFolderGraph = (node: any, parentId: string | null = null, depth = 0): { nodes: any[], links: any[] } => {
          const folderNodes: any[] = [];
          const folderLinks: any[] = [];
          
          const nodeId = node.path || node.name;
          
          folderNodes.push({
            id: nodeId,
            name: node.name,
            type: node.type === 'directory' ? 'client' : 'file', // client (pink) for folders, file (indigo) for files
            details: node.type === 'directory' ? 'Directory Folder' : `File: ${node.path}`
          });
          
          if (parentId) {
            folderLinks.push({ source: parentId, target: nodeId });
          }
          
          if (node.children && depth < 3) {
            // limit children per folder to prevent massive clutter
            node.children.slice(0, 8).forEach((child: any) => {
              const childData = buildFolderGraph(child, nodeId, depth + 1);
              folderNodes.push(...childData.nodes);
              folderLinks.push(...childData.links);
            });
          }
          
          return { nodes: folderNodes, links: folderLinks };
        };

        return buildFolderGraph(archData.folder_tree);
      }
    }

    return { nodes, links };
  };

  const getApiGraphData = () => {
    if (!archData) return { nodes: [], links: [] };
    const nodes: any[] = [];
    const links: any[] = [];
    
    // Add Client
    nodes.push({ id: 'user_browser', name: 'User Client', type: 'client', details: 'Web Browser / Fetch Dashboard API Requests' });
    
    archData.api_endpoints.forEach((api, idx) => {
      const apiId = `api_${idx}`;
      nodes.push({
        id: apiId,
        name: `${api.method} ${api.path}`,
        type: 'api',
        details: `Route definition. In file: ${api.file} (Line ${api.line})`
      });
      
      links.push({ source: 'user_browser', target: apiId, type: 'call' });
      
      // Connect api endpoint to the handler file
      if (api.file) {
        const fileId = api.file;
        if (!nodes.some(n => n.id === fileId)) {
          nodes.push({ id: fileId, name: fileId.split('/').pop() || fileId, type: 'file', details: `API route definition and logic. path: ${fileId}` });
        }
        links.push({ source: apiId, target: fileId, type: 'import' });
      }
    });
    
    return { nodes, links };
  };

  const getDatabaseGraphData = () => {
    if (!archData) return { nodes: [], links: [] };
    const nodes: any[] = [];
    const links: any[] = [];
    
    archData.db_models.forEach(model => {
      nodes.push({
        id: model.name,
        name: model.name,
        type: 'table',
        fields: model.fields,
        details: `Database table schema. Injected from model definition in: ${model.file}`
      });
    });
    
    // For relations, if schemas contain names like 'user_id' matching another table 'User'
    archData.db_models.forEach(model => {
      model.fields.forEach(field => {
        if (field.endsWith('_id')) {
          const possibleTable = field.replace('_id', '').toLowerCase();
          const targetTable = archData.db_models.find(m => m.name.toLowerCase() === possibleTable || m.name.toLowerCase() + 's' === possibleTable);
          if (targetTable && targetTable.name !== model.name) {
            links.push({ source: model.name, target: targetTable.name, type: 'fk' });
          }
        }
      });
    });
    
    return { nodes, links };
  };

  const graphData = getGraphData();
  const apiGraphData = getApiGraphData();
  const dbGraphData = getDatabaseGraphData();

  return (
    <div className="flex flex-col min-h-screen bg-[#080b11] text-slate-200">
      
      {/* Header Bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-4 bg-slate-950/80 border-b border-slate-900 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-lg shadow-indigo-500/20 text-white font-black text-lg">
            A
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-slate-100 to-slate-300 bg-clip-text text-transparent">Antigravity</h1>
            <p className="text-[10px] font-semibold text-indigo-400 tracking-widest uppercase">Software Architecture Assistant</p>
          </div>
        </div>
        
        <div className="hidden md:flex items-center gap-3">
          {/* Backend health dot */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              backendOnline === null ? 'bg-slate-500 animate-pulse' :
              backendOnline ? 'bg-emerald-400' : 'bg-rose-500 animate-pulse'
            }`} />
            <span className={`font-mono ${
              backendOnline === null ? 'text-slate-500' :
              backendOnline ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {backendOnline === null ? 'connecting...' : backendOnline ? 'backend online' : 'backend offline'}
            </span>
          </div>

          {/* Repo index info */}
          {indexStatus === 'ready' && (
            <>
              <span className="text-slate-700">|</span>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs">
                <Layers size={14} className="text-indigo-400" />
                <span className="font-semibold text-slate-300">{repoInfo.repo_name}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">{repoInfo.file_count} files</span>
              </div>
              <button
                onClick={() => { setIndexStatus('idle'); setArchData(null); }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-xs transition cursor-pointer"
              >
                Load Different Repo
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto px-6 py-8">
          
          {/* Backend offline banner */}
          {backendOnline === false && indexStatus !== 'indexing' && (
            <div className="max-w-2xl mx-auto mb-4 flex items-start gap-3 px-4 py-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Backend server is offline</p>
                <p className="mt-0.5 font-mono text-rose-300/80">Run this command from <strong>E:\ai\rag</strong> to start it:</p>
                <p className="mt-1 font-mono bg-rose-500/10 rounded px-2 py-1 select-all">.\ backend\venv\Scripts\python run.py</p>
              </div>
            </div>
          )}

          {/* Indexing Input Section — always show unless actively indexing or ready */}
          {indexStatus !== 'ready' && indexStatus !== 'indexing' && (
            <div className="max-w-2xl mx-auto my-12 p-8 rounded-2xl bg-slate-950 border border-slate-900 shadow-2xl glass-panel relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl animate-pulse-glow"></div>
              
              <div className="flex items-center gap-3.5 mb-6">
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
                  <GitFork size={24} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">Load Project Repository</h2>
                  <p className="text-xs text-slate-400">Scan folders, map module structures, analyze dependencies, and open code chat.</p>
                </div>
              </div>
              
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold text-slate-400">Local Folder Path or Git Repository URL</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={pathOrUrl}
                    onChange={(e) => setPathOrUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !loadingIndex && backendOnline && startIndexing()}
                    placeholder="e.g. E:/projects/my-app  or  https://github.com/user/repo.git"
                    className="flex-1 px-4 py-3 rounded-xl text-sm glass-input"
                  />
                  <button
                    id="scan-btn"
                    onClick={startIndexing}
                    disabled={loadingIndex || backendOnline === false}
                    title={backendOnline === false ? 'Start the backend server first' : 'Scan repository'}
                    className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-indigo-500/20 cursor-pointer"
                  >
                    {loadingIndex ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />}
                    Scan
                  </button>
                </div>
              </div>
              
              {indexStatus === 'error' && (
                <div className="flex items-start gap-3 mt-5 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                  <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                  <div className="text-xs flex-1">
                    <p className="font-bold">Indexing Error</p>
                    <p className="mt-1 font-mono break-all">{repoInfo.error_message}</p>
                    <button
                      onClick={() => { setIndexStatus('idle'); setRepoInfo({ error_message: '' }); }}
                      className="mt-3 text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                    >Clear and try again</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {indexStatus === 'indexing' && (
            <div className="max-w-md mx-auto my-24 text-center space-y-6">
              <div className="inline-block relative">
                <div className="w-16 h-16 rounded-2xl border-2 border-indigo-500/20 flex items-center justify-center bg-indigo-500/5">
                  <RefreshCw className="animate-spin text-indigo-400" size={32} />
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#080b11] border border-slate-800 flex items-center justify-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 block animate-ping"></span>
                </div>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Scanning Project Codebase</h3>
                <p className="text-xs text-indigo-400 font-mono mt-2">{progressStep}</p>
              </div>
              {/* Real-time progress bar */}
              <div className="w-full max-w-xs mx-auto space-y-1.5">
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>Progress</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              <p className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Repository: {repoInfo.repo_name}</p>
            </div>
          )}

          {/* Core Dashboard UI */}
          {indexStatus === 'ready' && (
            <div className="space-y-6">
              
              {/* Navigation Tabs */}
              <div className="flex border-b border-slate-900/80 gap-1 pb-px">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-150 cursor-pointer ${
                    activeTab === 'dashboard'
                      ? 'border-indigo-500 text-indigo-300 bg-indigo-500/5'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20'
                  }`}
                >
                  <Code2 size={16} />
                  Architecture Map
                </button>
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-150 cursor-pointer ${
                    activeTab === 'chat'
                      ? 'border-indigo-500 text-indigo-300 bg-indigo-500/5'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20'
                  }`}
                >
                  <MessageSquare size={16} />
                  AI RAG Chat
                </button>
                <button
                  onClick={() => setActiveTab('refactoring')}
                  className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-150 cursor-pointer ${
                    activeTab === 'refactoring'
                      ? 'border-indigo-500 text-indigo-300 bg-indigo-500/5'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20'
                  }`}
                >
                  <Terminal size={16} />
                  Refactoring Hub
                </button>
                <button
                  onClick={() => setActiveTab('documentation')}
                  className={`flex items-center gap-2 px-5 py-3 border-b-2 font-semibold text-sm transition-all duration-150 cursor-pointer ${
                    activeTab === 'documentation'
                      ? 'border-indigo-500 text-indigo-300 bg-indigo-500/5'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/20'
                  }`}
                >
                  <BookOpen size={16} />
                  Documentation Hub
                </button>
              </div>

              {/* TAB 1: ARCHITECTURE MAP */}
              {activeTab === 'dashboard' && archData && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {/* Left Column: Collapsible File Explorer */}
                  <div className="lg:col-span-3 flex flex-col h-[550px] bg-slate-950/60 border border-slate-900 rounded-xl p-4 overflow-hidden glass-panel">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                      <FolderOpen size={14} className="text-indigo-400" />
                      <span>Workspace Files</span>
                    </div>
                    <div className="flex-1 overflow-y-auto pr-1">
                      <FileTree
                        node={archData.folder_tree}
                        onFileSelect={(path) => selectFile(path)}
                        selectedFile={selectedFile}
                      />
                    </div>
                  </div>

                  {/* Center Column: Graph and Stats */}
                  <div className="lg:col-span-9 space-y-6">
                    
                    {/* Visualizer Toggle Section */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Dependencies Node Graph */}
                      <div className="p-4 bg-slate-950 border border-slate-900 rounded-xl glass-panel relative overflow-hidden">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-slate-300">
                            <Layers size={16} className="text-indigo-400" />
                            <span className="font-bold text-xs">Module Imports</span>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-slate-400">{archData.imports.length} Links</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2">Visualization ring representing local module imports.</p>
                      </div>

                      {/* API Endpoints */}
                      <div className="p-4 bg-slate-950 border border-slate-900 rounded-xl glass-panel relative overflow-hidden">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-slate-300">
                            <Server size={16} className="text-cyan-400" />
                            <span className="font-bold text-xs">API Endpoints</span>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-cyan-400">{archData.api_endpoints.length} Routes</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2">HTTP route handlers (FastAPI decorator paths / Express endpoints).</p>
                      </div>

                      {/* Database Models */}
                      <div className="p-4 bg-slate-950 border border-slate-900 rounded-xl glass-panel relative overflow-hidden">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-slate-300">
                            <Database size={16} className="text-pink-400" />
                            <span className="font-bold text-xs">SQL / Database</span>
                          </div>
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-pink-400">{archData.db_models.length} Tables</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2">SQL schemas & ORM class models mapping database schemas.</p>
                      </div>
                    </div>

                    {/* Rendering SVG Visualizer */}
                    <div className="space-y-4">
                      {/* Tabs inside Visualizer */}
                      <div className="flex gap-2 p-1.5 bg-slate-900/60 border border-slate-850 rounded-lg w-fit">
                        {['dependency', 'api', 'database'].map((tab) => (
                          <button
                            key={tab}
                            onClick={() => {
                              // Force visualizer view swap
                              const elem = document.getElementById('visualizer-toggle-btn');
                              if (elem) elem.setAttribute('data-tab', tab);
                              // We just use dummy buttons and trigger redraws
                              // Let's create an active graph state
                              (window as any).activeGraphTab = tab;
                              setActiveTab('dashboard'); // trigger redraw
                            }}
                            className={`px-3 py-1 rounded-md text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                              ((window as any).activeGraphTab || 'dependency') === tab
                                ? 'bg-indigo-600 text-white shadow'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {tab} Diagram
                          </button>
                        ))}
                      </div>

                      <ArchitectureGraph
                        viewType={((window as any).activeGraphTab || 'dependency') as any}
                        rawNodes={
                          ((window as any).activeGraphTab || 'dependency') === 'api'
                            ? apiGraphData.nodes
                            : ((window as any).activeGraphTab || 'dependency') === 'database'
                            ? dbGraphData.nodes
                            : graphData.nodes
                        }
                        rawLinks={
                          ((window as any).activeGraphTab || 'dependency') === 'api'
                            ? apiGraphData.links
                            : ((window as any).activeGraphTab || 'dependency') === 'database'
                            ? dbGraphData.links
                            : graphData.links
                        }
                        onNodeSelect={(path) => selectFile(path)}
                      />
                    </div>

                    {/* Detected Languages Stats Card */}
                    <div className="p-5 bg-slate-950 border border-slate-900 rounded-xl glass-panel">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Detected Programming Languages</h3>
                      <div className="w-full h-3 bg-slate-900 rounded-full flex overflow-hidden mb-4 border border-slate-850">
                        {archData.languages.map((l, idx) => {
                          const colors = ['#6366f1', '#06b6d4', '#ec4899', '#f59e0b', '#10b981'];
                          const color = colors[idx % colors.length];
                          return (
                            <div
                              key={l.language}
                              style={{ width: `${l.percentage}%`, backgroundColor: color }}
                              title={`${l.language}: ${l.count} files (${l.percentage}%)`}
                              className="h-full first:rounded-l-full last:rounded-r-full"
                            ></div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {archData.languages.map((l, idx) => {
                          const colors = ['bg-indigo-500', 'bg-cyan-500', 'bg-pink-500', 'bg-amber-500', 'bg-emerald-500'];
                          const colorClass = colors[idx % colors.length];
                          return (
                            <div key={l.language} className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${colorClass}`}></span>
                              <span className="text-xs font-semibold text-slate-300">{l.language}</span>
                              <span className="text-[10px] text-slate-500 font-mono">({l.percentage}%)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* TAB 2: AI RAG CHAT */}
              {activeTab === 'chat' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[550px]">
                  
                  {/* Chat Message Window */}
                  <div className="lg:col-span-8 flex flex-col bg-slate-950/60 border border-slate-900 rounded-xl overflow-hidden glass-panel h-full">
                    {/* Chat Messages */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-5">
                      {chatMessages.length === 0 && (
                        <div className="flex flex-col items-center justify-center text-center h-full max-w-sm mx-auto space-y-4">
                          <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl text-indigo-400">
                            <Sparkles size={24} className="animate-pulse" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-100">Ask Codebase Questions</h3>
                            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                              Ask how user authentication works, where certain settings are initialized, or how database hooks map objects.
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {chatMessages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center font-bold text-xs ${
                              msg.role === 'user' 
                                ? 'bg-indigo-600 text-white' 
                                : 'bg-slate-900 border border-slate-800 text-indigo-400'
                            }`}>
                              {msg.role === 'user' ? 'U' : 'AI'}
                            </div>
                            <div className="space-y-2">
                              <div className={`p-4 rounded-2xl text-xs leading-relaxed border ${
                                msg.role === 'user' 
                                  ? 'bg-indigo-500/10 border-indigo-500/20 text-slate-200' 
                                  : 'bg-slate-900/40 border-slate-900 text-slate-300'
                              }`}>
                                <pre className="whitespace-pre-wrap font-sans text-xs">{msg.content}</pre>
                              </div>
                              
                              {/* Citations badges */}
                              {msg.sources && msg.sources.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pl-1">
                                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider self-center mr-1">Sources Cited:</span>
                                  {msg.sources.map((src, sIdx) => {
                                    const sourceName = src.file_path.split('/').pop() || src.file_path;
                                    return (
                                      <button
                                        key={sIdx}
                                        onClick={() => selectFile(src.file_path, { start: src.start_line, end: src.end_line })}
                                        className="text-[10px] px-2 py-0.5 citation-badge rounded flex items-center gap-1 font-mono cursor-pointer"
                                      >
                                        <FileCode size={11} />
                                        {sourceName}:{src.start_line}-{src.end_line}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {loadingChat && (
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-indigo-400 flex items-center justify-center font-bold text-xs">
                            AI
                          </div>
                          <div className="p-4 bg-slate-900/40 border border-slate-900 rounded-2xl flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Chat Input */}
                    <div className="p-4 bg-slate-950 border-t border-slate-900 flex gap-2">
                      <input
                        type="text"
                        value={chatQuestion}
                        onChange={(e) => setChatQuestion(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
                        placeholder="E.g. How does user authentication work in this repo?"
                        className="flex-1 px-4 py-3 rounded-xl text-xs glass-input"
                      />
                      <button
                        onClick={sendChatMessage}
                        disabled={loadingChat || !chatQuestion.trim()}
                        className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Code viewer in chat */}
                  <div className="lg:col-span-4 h-full">
                    {isViewerOpen ? (
                      <CodeViewer
                        fileName={selectedFile}
                        code={fileContent}
                        highlightRange={highlightRange}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center p-6 border border-slate-900 rounded-xl h-full bg-slate-950/20 text-slate-500 font-mono text-xs">
                        <Info size={18} className="mb-2 text-slate-600" />
                        Click a cited source link in chat to display the code side-by-side.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: REFACTORING HUB */}
              {activeTab === 'refactoring' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {/* Static smells summary column */}
                  <div className="lg:col-span-4 space-y-6">
                    
                    {/* Circular Dependencies Card */}
                    <div className="p-5 bg-slate-950 border border-slate-900 rounded-xl glass-panel">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle size={18} className="text-rose-400" />
                        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Circular Dependencies</h3>
                      </div>
                      
                      {smells?.circular_dependencies && smells.circular_dependencies.length > 0 ? (
                        <div className="space-y-3">
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            We found circular import pathways. These create tight coupling between files and can break code execution.
                          </p>
                          <div className="space-y-2">
                            {smells.circular_dependencies.map((cycle, idx) => (
                              <div key={idx} className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-lg text-[10px] font-mono text-rose-300 leading-relaxed">
                                <span className="font-bold block mb-1">Cycle #{idx + 1}:</span>
                                {cycle.join(' ➔ ')}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg text-emerald-400 text-xs font-semibold">
                          <CheckCircle2 size={16} />
                          No circular dependencies found!
                        </div>
                      )}
                    </div>

                    {/* Long Functions list */}
                    <div className="p-5 bg-slate-950 border border-slate-900 rounded-xl glass-panel h-[350px] flex flex-col">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Long Code Blocks (&gt;60 LOC)</h3>
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {smells?.long_functions && smells.long_functions.length > 0 ? (
                          smells.long_functions.map((fn, idx) => (
                            <div
                              key={idx}
                              onClick={() => fetchRefactorAdvice(fn.file_path)}
                              className={`p-3 border rounded-lg cursor-pointer transition-all ${
                                activeRefactorFile === fn.file_path
                                  ? 'bg-indigo-500/10 border-indigo-500 text-indigo-300'
                                  : 'bg-slate-900/40 border-slate-850 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex justify-between text-xs font-bold">
                                <span className="truncate max-w-[150px]">{fn.function_name}()</span>
                                <span className="text-rose-400 text-[10px] font-mono">{fn.lines} lines</span>
                              </div>
                              <span className="text-[10px] text-slate-500 block truncate mt-1">{fn.file_path} (L{fn.range})</span>
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-500 text-xs italic text-center py-12">No large files or long methods detected.</div>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Refactoring Advice Panel */}
                  <div className="lg:col-span-8">
                    {activeRefactorFile ? (
                      <div className="bg-slate-950/60 border border-slate-900 rounded-xl p-6 glass-panel min-h-[500px] flex flex-col">
                        
                        {/* Advice Header */}
                        <div className="flex justify-between items-center pb-4 border-b border-slate-900">
                          <div>
                            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Refactoring Analysis</h3>
                            <h2 className="text-sm font-semibold text-slate-200 mt-1 break-all">{activeRefactorFile.split('/').pop()}</h2>
                          </div>
                          <button
                            onClick={() => selectFile(activeRefactorFile)}
                            className="text-xs px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
                          >
                            View File Code
                          </button>
                        </div>

                        {loadingAdvice ? (
                          <div className="flex-1 flex flex-col items-center justify-center py-24 text-center space-y-4">
                            <RefreshCw className="animate-spin text-indigo-400" size={28} />
                            <p className="text-xs text-slate-400">LLM is scanning code block structures, analyzing performance smells, and generating improvements...</p>
                          </div>
                        ) : refactorAdvice ? (
                          <div className="space-y-6 mt-4 flex-1 overflow-y-auto max-h-[500px] pr-2">
                            
                            {/* Summary */}
                            <div className="p-4 bg-slate-900/60 border border-slate-850 rounded-xl text-xs leading-relaxed text-slate-300">
                              <span className="font-bold text-slate-200 block mb-1">Architecture Summary:</span>
                              {refactorAdvice.overall_summary}
                            </div>
                            
                            {/* Issues list */}
                            {refactorAdvice.issues && refactorAdvice.issues.length > 0 ? (
                              <div className="space-y-4">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Specific Code Smell Findings</h3>
                                {refactorAdvice.issues.map((issue, idx) => (
                                  <div key={idx} className="border border-slate-900 rounded-xl p-4 bg-slate-950 space-y-3">
                                    <div className="flex justify-between text-xs font-bold">
                                      <span className="text-slate-300">{issue.description}</span>
                                      <span className={`px-2 py-0.5 text-[9px] rounded font-mono uppercase tracking-widest ${
                                        issue.severity === 'high' 
                                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                      }`}>
                                        {issue.severity}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-slate-500 block font-mono">Target: Lines {issue.lines}</span>
                                    
                                    {/* Code Diff Display */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
                                      {/* Original Code */}
                                      <div className="border border-rose-500/20 rounded-lg overflow-hidden bg-[#0d1117]">
                                        <div className="bg-rose-500/5 px-3 py-1.5 border-b border-rose-500/20 text-rose-400 font-bold text-[10px] uppercase">Original Code</div>
                                        <pre className="p-3 overflow-x-auto text-slate-400 leading-5 whitespace-pre max-h-[160px]">{issue.original_code}</pre>
                                      </div>
                                      {/* Refactored Code */}
                                      <div className="border border-emerald-500/20 rounded-lg overflow-hidden bg-[#0d1117] relative group">
                                        <div className="bg-emerald-500/5 px-3 py-1.5 border-b border-emerald-500/20 text-emerald-400 font-bold text-[10px] uppercase flex justify-between items-center">
                                          <span>Suggested Refactor</span>
                                          <button
                                            onClick={() => copyRefactoredCode(issue.suggested_refactor, idx)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 hover:bg-slate-700 text-slate-300 p-1 rounded border border-slate-700 cursor-pointer"
                                            title="Copy refactored code"
                                          >
                                            {copiedBlockIdx === idx ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                                          </button>
                                        </div>
                                        <pre className="p-3 overflow-x-auto text-slate-300 leading-5 whitespace-pre max-h-[160px]">{issue.suggested_refactor}</pre>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-slate-500 italic text-xs">No deep issues detected for this file. Ready for review!</div>
                            )}

                          </div>
                        ) : null}

                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center p-12 border border-slate-900 rounded-xl h-full bg-slate-950/20 text-slate-500 font-mono text-xs">
                        <Terminal size={24} className="mb-2 text-slate-600" />
                        Select a file from the list on the left to trigger deep LLM refactoring recommendations and code corrections.
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* TAB 4: DOCUMENTATION HUB */}
              {activeTab === 'documentation' && (
                <div className="max-w-4xl mx-auto space-y-6">
                  
                  {/* Actions Bar */}
                  <div className="flex justify-between items-center p-4 bg-slate-950 border border-slate-900 rounded-xl glass-panel">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">Architecture & Technical Docs</h3>
                      <p className="text-xs text-slate-400">Generate a production-quality architecture summary, API specification table, and schema diagrams.</p>
                    </div>
                    
                    <div className="flex gap-2">
                      {docMarkdown && (
                        <button
                          onClick={copyDocsToClipboard}
                          className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-850 text-slate-300 font-semibold border border-slate-800 rounded-lg text-xs transition cursor-pointer"
                        >
                          {copiedDocs ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                          {copiedDocs ? 'Copied!' : 'Copy Markdown'}
                        </button>
                      )}
                      <button
                        onClick={generateDocs}
                        disabled={loadingDocs}
                        className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition disabled:opacity-50 cursor-pointer shadow-lg hover:shadow-indigo-500/20"
                      >
                        {loadingDocs ? <RefreshCw className="animate-spin" size={14} /> : <Sparkles size={14} />}
                        {docMarkdown ? 'Re-Generate' : 'Generate Guide'}
                      </button>
                    </div>
                  </div>

                  {/* Rendering Content */}
                  {loadingDocs ? (
                    <div className="flex flex-col items-center justify-center py-32 text-center bg-slate-950/20 border border-slate-900 rounded-2xl space-y-4">
                      <RefreshCw className="animate-spin text-indigo-400" size={32} />
                      <p className="text-xs text-slate-400 max-w-sm">Aggregating parsed AST structures, file layout metadata, and API registries to compile the technical documentation guide...</p>
                    </div>
                  ) : docMarkdown ? (
                    <div className="p-8 bg-[#0d1117] border border-slate-850 rounded-2xl shadow-xl overflow-auto max-h-[600px]">
                      <div className="prose prose-invert max-w-none text-xs leading-6 text-slate-300">
                        <pre className="whitespace-pre-wrap font-sans text-xs">{docMarkdown}</pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center bg-slate-950/20 border border-slate-900 rounded-2xl text-slate-500 font-mono text-xs">
                      <BookOpen size={24} className="mb-2 text-slate-600 animate-bounce" />
                      Click "Generate Guide" to auto-compile full codebase documentation.
                    </div>
                  )}

                </div>
              )}

            </div>
          )}

        </main>
      </div>

      {/* Global File Viewer Drawer / Overlay */}
      {isViewerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/60 backdrop-blur-sm">
          <div className="w-[85vw] md:w-[60vw] lg:w-[45vw] h-full flex flex-col bg-slate-950 border-l border-slate-900 shadow-2xl relative">
            
            {/* Close Button overlay */}
            <button
              onClick={() => setIsViewerOpen(false)}
              className="absolute top-3 right-4 z-50 px-3 py-1 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg text-xs font-semibold cursor-pointer"
            >
              Close
            </button>
            
            <div className="flex-1 p-4 overflow-hidden mt-6">
              <CodeViewer
                fileName={selectedFile}
                code={fileContent}
                highlightRange={highlightRange}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
