import React, { useState, useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface Node {
  id: string;
  name: string;
  type: 'file' | 'api' | 'table' | 'client';
  details?: string;
  fields?: string[]; // For DB tables
  x?: number;
  y?: number;
}

interface Link {
  source: string;
  target: string;
  type?: 'import' | 'call' | 'fk';
}

interface ArchitectureGraphProps {
  viewType: 'dependency' | 'api' | 'database';
  rawNodes: Node[];
  rawLinks: Link[];
  onNodeSelect?: (nodeId: string) => void;
}

export const ArchitectureGraph: React.FC<ArchitectureGraphProps> = ({
  viewType,
  rawNodes,
  rawLinks,
  onNodeSelect
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  
  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(0.8);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 100, y: 100 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  
  // Drag state
  const [draggedNode, setDraggedNode] = useState<string | null>(null);

  // Compute Layouts
  useEffect(() => {
    if (rawNodes.length === 0) return;

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 500;
    const center = { x: width / 2, y: height / 2 };

    const initialNodes = rawNodes.map(n => ({ ...n }));
    const idMap: { [key: string]: typeof initialNodes[0] } = {};
    initialNodes.forEach(n => { idMap[n.id] = n; });

    if (viewType === 'dependency') {
      // Concentric circular layout
      // Sort nodes by connectivity degree
      const degrees: { [key: string]: number } = {};
      initialNodes.forEach(n => { degrees[n.id] = 0; });
      rawLinks.forEach(l => {
        if (degrees[l.source] !== undefined) degrees[l.source]++;
        if (degrees[l.target] !== undefined) degrees[l.target]++;
      });

      const sorted = [...initialNodes].sort((a, b) => degrees[b.id] - degrees[a.id]);
      
      // Ring 0 (Center): Top 2 nodes
      // Ring 1 (Middle): next 40%
      // Ring 2 (Outer): remaining
      sorted.forEach((node, idx) => {
        let r = 0;
        let theta = 0;
        
        if (idx < 2) {
          r = 0; // Center
          node.x = center.x + (idx === 0 ? -30 : 30);
          node.y = center.y;
        } else if (idx < Math.max(5, sorted.length * 0.4)) {
          r = 130; // Ring 1
          const count = Math.floor(Math.max(5, sorted.length * 0.4) - 2);
          const posIdx = idx - 2;
          theta = (posIdx / count) * 2 * Math.PI;
          node.x = center.x + r * Math.cos(theta);
          node.y = center.y + r * Math.sin(theta);
        } else {
          r = 250; // Ring 2
          const count = sorted.length - Math.floor(Math.max(5, sorted.length * 0.4));
          const posIdx = idx - Math.floor(Math.max(5, sorted.length * 0.4));
          theta = (posIdx / count) * 2 * Math.PI;
          node.x = center.x + r * Math.cos(theta);
          node.y = center.y + r * Math.sin(theta);
        }
      });
    } else if (viewType === 'api') {
      // Flow layout: Client (Left) -> API routes (Middle) -> Files (Right)
      const clients = initialNodes.filter(n => n.type === 'client');
      const apis = initialNodes.filter(n => n.type === 'api');
      const files = initialNodes.filter(n => n.type === 'file');

      const setColumnPositions = (nodesCol: Node[], colX: number) => {
        const spacing = height / (nodesCol.length + 1);
        nodesCol.forEach((node, idx) => {
          node.x = colX;
          node.y = spacing * (idx + 1);
        });
      };

      setColumnPositions(clients.length > 0 ? clients : [{ id: 'user_browser', name: 'User Dashboard', type: 'client' }], 100);
      setColumnPositions(apis, width / 2);
      setColumnPositions(files, width - 150);
    } else if (viewType === 'database') {
      // Grid DB ERD layout: display as boxes with columns
      const cols = 3;
      initialNodes.forEach((node, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        node.x = 100 + col * 280;
        node.y = 80 + row * 220;
      });
    }

    setNodes(initialNodes);
    setLinks(rawLinks);
    // Reset view slightly centered
    setPan({ x: (width - width * zoom) / 2, y: (height - height * zoom) / 2 });
  }, [viewType, rawNodes, rawLinks]);

  // Mouse Handlers for Pan & Zoom
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target instanceof SVGSVGElement || (e.target as SVGElement).classList.contains('background-grid')) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (draggedNode !== null) {
      // Node dragging logic
      const rect = e.currentTarget.getBoundingClientRect();
      // Calculate coordinates scaled to zoom
      const mouseX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseY = (e.clientY - rect.top - pan.y) / zoom;
      
      setNodes(prev => prev.map(n => n.id === draggedNode ? { ...n, x: mouseX, y: mouseY } : n));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggedNode(null);
  };

  const handleZoom = (factor: number) => {
    setZoom(prev => Math.max(0.2, Math.min(3, prev + factor)));
  };

  const handleReset = () => {
    setZoom(0.8);
    setPan({ x: 100, y: 100 });
    setSelectedNode(null);
  };

  const handleNodeClick = (node: Node) => {
    setSelectedNode(node.id === selectedNode ? null : node.id);
    if (onNodeSelect && node.type === 'file') {
      onNodeSelect(node.id);
    }
  };

  // Check if a node/link is dimmed based on selections
  const isDimmedNode = (nodeId: string) => {
    if (!selectedNode && !hoveredNode) return false;
    const focusId = selectedNode || hoveredNode;
    if (focusId === nodeId) return false;
    
    // Check if connected
    return !links.some(l => 
      (l.source === focusId && l.target === nodeId) || 
      (l.target === focusId && l.source === nodeId)
    );
  };

  const isHighlightedLink = (link: Link) => {
    const focusId = selectedNode || hoveredNode;
    if (!focusId) return false;
    return link.source === focusId || link.target === focusId;
  };

  return (
    <div ref={containerRef} className="relative w-full h-[550px] bg-slate-950/80 rounded-xl border border-slate-800/80 overflow-hidden shadow-2xl glass-panel">
      {/* HUD Control Overlay */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <button onClick={() => handleZoom(0.1)} className="p-2 bg-slate-900/90 border border-slate-800 rounded-lg text-slate-400 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-slate-900 transition-all shadow-md" title="Zoom In">
          <ZoomIn size={16} />
        </button>
        <button onClick={() => handleZoom(-0.1)} className="p-2 bg-slate-900/90 border border-slate-800 rounded-lg text-slate-400 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-slate-900 transition-all shadow-md" title="Zoom Out">
          <ZoomOut size={16} />
        </button>
        <button onClick={handleReset} className="p-2 bg-slate-900/90 border border-slate-800 rounded-lg text-slate-400 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-slate-900 transition-all shadow-md" title="Reset View">
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 border border-slate-850 text-xs font-semibold rounded-lg text-slate-400">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 block animate-pulse"></span>
          <span className="capitalize">{viewType} Model</span>
        </div>
      </div>

      {/* SVG Canvas */}
      <svg
        className="w-full h-full cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Background Grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect className="background-grid" width="100%" height="100%" fill="url(#grid)" />

        {/* Zoomed Group */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Render Connections */}
          {links.map((link, idx) => {
            const sourceNode = nodes.find(n => n.id === link.source);
            const targetNode = nodes.find(n => n.id === link.target);
            if (!sourceNode || !targetNode) return null;

            const x1 = sourceNode.x || 0;
            const y1 = sourceNode.y || 0;
            const x2 = targetNode.x || 0;
            const y2 = targetNode.y || 0;

            const isHighlighted = isHighlightedLink(link);
            const focusId = selectedNode || hoveredNode;
            const isDimmed = focusId && !isHighlighted;

            return (
              <g key={`link-${idx}`}>
                {/* Arrow markers for flow */}
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(99, 102, 241, 0.4)" />
                  </marker>
                  <marker id="arrow-high" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#6366f1" />
                  </marker>
                </defs>

                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isHighlighted ? '#6366f1' : 'rgba(148, 163, 184, 0.15)'}
                  strokeWidth={isHighlighted ? 2.5 : 1}
                  strokeDasharray={viewType === 'api' ? '5,5' : 'none'}
                  markerEnd={viewType === 'api' ? `url(${isHighlighted ? '#arrow-high' : '#arrow'})` : 'none'}
                  opacity={isDimmed ? 0.15 : 1}
                  className="transition-all duration-300"
                />
              </g>
            );
          })}

          {/* Render Nodes */}
          {nodes.map(node => {
            const x = node.x || 0;
            const y = node.y || 0;
            const isDimmed = isDimmedNode(node.id);
            const isSelected = selectedNode === node.id;
            const isHovered = hoveredNode === node.id;

            // Database table visualization (Box layout)
            if (viewType === 'database' && node.type === 'table') {
              const boxW = 200;
              const titleH = 36;
              const fieldH = 22;
              const fieldsList = node.fields || [];
              const boxH = titleH + Math.max(1, fieldsList.length) * fieldH + 10;

              return (
                <g
                  key={node.id}
                  transform={`translate(${x - boxW/2}, ${y - boxH/2})`}
                  className={`cursor-pointer transition-all duration-300 ${isDimmed ? 'opacity-25' : 'opacity-100'}`}
                  onClick={() => handleNodeClick(node)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  {/* Table Box */}
                  <rect
                    width={boxW}
                    height={boxH}
                    rx={8}
                    fill="#0f172a"
                    stroke={isSelected || isHovered ? '#6366f1' : '#1e293b'}
                    strokeWidth={isSelected ? 2 : 1}
                    className="shadow-xl"
                  />
                  {/* Header */}
                  <path
                    d={`M 0 8 A 8 8 0 0 1 8 0 L ${boxW - 8} 0 A 8 8 0 0 1 ${boxW} 8 L ${boxW} ${titleH} L 0 ${titleH} Z`}
                    fill={isSelected || isHovered ? 'rgba(99, 102, 241, 0.15)' : 'rgba(30, 41, 59, 0.6)'}
                  />
                  <text
                    x={boxW / 2}
                    y={22}
                    textAnchor="middle"
                    fill={isSelected || isHovered ? '#a5b4fc' : '#94a3b8'}
                    className="text-xs font-bold font-sans"
                  >
                    {node.name}
                  </text>
                  {/* Separator */}
                  <line x1={0} y1={titleH} x2={boxW} y2={titleH} stroke="#1e293b" />
                  
                  {/* Table Fields */}
                  {fieldsList.length === 0 ? (
                    <text x={12} y={titleH + 20} fill="#64748b" className="text-[10px] font-mono italic">
                      No columns detected
                    </text>
                  ) : (
                    fieldsList.map((field, fIdx) => (
                      <g key={fIdx} transform={`translate(0, ${titleH + 18 + fIdx * fieldH})`}>
                        <circle cx={14} cy={-4} r={3} fill="#6366f1" opacity={0.7} />
                        <text x={26} y={0} fill="#cbd5e1" className="text-[11px] font-mono">
                          {field}
                        </text>
                      </g>
                    ))
                  )}
                </g>
              );
            }

            // Normal node rendering (Circles for other models)
            let color = '#475569'; // default
            if (node.type === 'file') color = '#6366f1'; // indigo
            if (node.type === 'api') color = '#06b6d4'; // cyan
            if (node.type === 'client') color = '#ec4899'; // pink

            return (
              <g
                key={node.id}
                transform={`translate(${x}, ${y})`}
                className={`cursor-pointer transition-all duration-300 ${isDimmed ? 'opacity-25' : 'opacity-100'}`}
                onClick={() => handleNodeClick(node)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggedNode(node.id);
                }}
              >
                {/* Selection outer ring */}
                {(isSelected || isHovered) && (
                  <circle
                    r={20}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                    className="animate-ping"
                    style={{ animationDuration: '3s' }}
                    opacity={0.3}
                  />
                )}
                {/* Node circle */}
                <circle
                  r={12}
                  fill="#0b0f19"
                  stroke={isSelected || isHovered ? color : '#334155'}
                  strokeWidth={isSelected ? 3 : 1.5}
                  className="transition-all duration-150"
                />
                <circle
                  r={6}
                  fill={color}
                  opacity={isSelected || isHovered ? 1 : 0.8}
                />
                {/* Node label */}
                <text
                  y={24}
                  textAnchor="middle"
                  fill={isSelected || isHovered ? '#f8fafc' : '#94a3b8'}
                  className="text-[11px] font-sans font-medium"
                >
                  {node.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      
      {/* Node Details Overlay Panel */}
      {(selectedNode || hoveredNode) && (
        <div className="absolute bottom-4 right-4 max-w-sm p-4 bg-slate-900/95 border border-slate-800 rounded-xl shadow-2xl glass-panel transition-all">
          {(() => {
            const activeNode = nodes.find(n => n.id === (selectedNode || hoveredNode));
            if (!activeNode) return null;
            return (
              <div>
                <h4 className="text-xs font-bold tracking-wider text-slate-500 uppercase">Node Inspector</h4>
                <h3 className="text-sm font-semibold text-slate-100 mt-1 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeNode.type === 'file' ? '#6366f1' : activeNode.type === 'api' ? '#06b6d4' : '#ec4899' }}></span>
                  {activeNode.name}
                </h3>
                <p className="text-xs text-slate-400 mt-2 font-mono break-all">{activeNode.details || 'No additional file details parsed.'}</p>
                {activeNode.fields && activeNode.fields.length > 0 && (
                  <div className="mt-2.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Columns</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {activeNode.fields.map(f => (
                        <span key={f} className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700/60 font-mono text-slate-300">{f}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
export default ArchitectureGraph;
