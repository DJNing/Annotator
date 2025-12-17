import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CanvasEditor } from './components/CanvasEditor';
import { Button } from './components/Button';
import { ToolType, SegmentationLayer, PREDEFINED_COLORS, MaskState } from './types';
import { detectObjectsInImage } from './services/geminiService';
import { 
  Upload, 
  Download, 
  Layers, 
  Eraser, 
  Brush, 
  Move, 
  ZoomIn, 
  ZoomOut, 
  Plus, 
  Eye, 
  EyeOff, 
  Trash2,
  Wand2,
  X,
  PenTool,
  Sparkles,
  RotateCcw,
  RotateCw
} from 'lucide-react';

interface HistoryItem {
  layers: SegmentationLayer[];
  masks: MaskState;
}

const App: React.FC = () => {
  // State
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  
  // Current working state
  const [layers, setLayers] = useState<SegmentationLayer[]>([
    { id: 'fg', name: 'Foreground', color: '#ef4444', isVisible: true, isLocked: false }
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string>('fg');
  
  // History State
  const [historyPast, setHistoryPast] = useState<HistoryItem[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryItem[]>([]);
  // We need to keep track of the *current* mask state in App to push to history when needed,
  // even though CanvasEditor holds the source of truth for pixels.
  // This state is only populated when CanvasEditor reports a change.
  const currentMasksRef = useRef<MaskState>({});

  // Trigger state to tell CanvasEditor to load masks
  const [restoredMasks, setRestoredMasks] = useState<MaskState | null>(null);

  const [tool, setTool] = useState<ToolType>(ToolType.BRUSH);
  const [brushSize, setBrushSize] = useState<number>(20);
  const [tolerance, setTolerance] = useState<number>(30); // For Magic Wand
  const [zoom, setZoom] = useState<number>(1);
  
  const [isExporting, setIsExporting] = useState(false);
  const [exportMode, setExportMode] = useState<'rgba' | 'visual_mask' | 'training_mask' | 'instance' | 'white_bg'>('rgba');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Keyboard Shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyPast, historyFuture, layers]); // deps needed for closure

  // Handlers
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (typeof evt.target?.result === 'string') {
          setImageSrc(evt.target.result);
          // Reset state
          const initialLayers = [{ id: 'fg', name: 'Foreground', color: '#ef4444', isVisible: true, isLocked: false }];
          setLayers(initialLayers);
          setActiveLayerId('fg');
          setZoom(1);
          setHistoryPast([]);
          setHistoryFuture([]);
          currentMasksRef.current = {};
          setRestoredMasks({}); // Clear editor
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const pushToHistory = (newLayers: SegmentationLayer[], newMasks: MaskState) => {
    // Save current state to past
    setHistoryPast(prev => [...prev, { layers: newLayers, masks: newMasks }]);
    setHistoryFuture([]);
  };

  // Called when CanvasEditor finishes a stroke/action
  const handleSnapshot = useCallback((newMasks: MaskState) => {
    pushToHistory(layers, currentMasksRef.current);
    currentMasksRef.current = newMasks;
  }, [layers]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUndo = () => {
    if (historyPast.length === 0) return;

    const previousState = historyPast[historyPast.length - 1];
    const newPast = historyPast.slice(0, -1);

    // Push current state to future
    setHistoryFuture(prev => [{ layers, masks: currentMasksRef.current }, ...prev]);
    
    // Restore state
    setLayers(previousState.layers);
    currentMasksRef.current = previousState.masks;
    setRestoredMasks(previousState.masks); // Trigger CanvasEditor update
    setHistoryPast(newPast);

    // If active layer doesn't exist in previous state, fallback
    if (!previousState.layers.find(l => l.id === activeLayerId)) {
        setActiveLayerId(previousState.layers[0]?.id || 'fg');
    }
  };

  const handleRedo = () => {
    if (historyFuture.length === 0) return;

    const nextState = historyFuture[0];
    const newFuture = historyFuture.slice(1);

    // Push current to past
    setHistoryPast(prev => [...prev, { layers, masks: currentMasksRef.current }]);

    // Restore state
    setLayers(nextState.layers);
    currentMasksRef.current = nextState.masks;
    setRestoredMasks(nextState.masks);
    setHistoryFuture(newFuture);

     // If active layer doesn't exist, fallback
     if (!nextState.layers.find(l => l.id === activeLayerId)) {
        setActiveLayerId(nextState.layers[0]?.id || 'fg');
    }
  };

  const addLayer = (name: string = 'New Instance') => {
    // Push history before modifying
    pushToHistory(layers, currentMasksRef.current);

    const newId = `inst-${Date.now()}`;
    const color = PREDEFINED_COLORS[layers.length % PREDEFINED_COLORS.length];
    setLayers(prev => [
      ...prev,
      { id: newId, name, color, isVisible: true, isLocked: false }
    ]);
    setActiveLayerId(newId);
  };

  const updateLayer = (id: string, updates: Partial<SegmentationLayer>) => {
      // For simple metadata updates like name/color, strictly speaking we might not need to push
      // full mask history if pixel data doesn't change, but to be safe and consistent, we push.
      pushToHistory(layers, currentMasksRef.current);
      setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const removeLayer = (id: string) => {
    if (layers.length <= 1) return;
    
    // Push history
    pushToHistory(layers, currentMasksRef.current);

    setLayers(prev => prev.filter(l => l.id !== id));
    if (activeLayerId === id) {
        setActiveLayerId(layers[0].id);
    }
  };

  const toggleVisibility = (id: string) => {
    pushToHistory(layers, currentMasksRef.current);
    setLayers(prev => prev.map(l => l.id === id ? { ...l, isVisible: !l.isVisible } : l));
  };

  const handleExport = (mode: 'rgba' | 'visual_mask' | 'training_mask' | 'instance' | 'white_bg') => {
    setExportMode(mode);
    setIsExporting(true);
  };

  const handleExportComplete = (dataUrl: string) => {
    setIsExporting(false);
    const link = document.createElement('a');
    link.download = `segmentation-${exportMode}-${Date.now()}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const runAIDetection = async () => {
    if (!imageSrc) return;
    
    // Push history before AI
    pushToHistory(layers, currentMasksRef.current);

    setIsAnalyzing(true);
    try {
        const labels = await detectObjectsInImage(imageSrc);
        
        // Convert labels to layers
        if (labels.length > 0) {
            const newLayers = labels.map((label, idx) => ({
                id: `ai-${idx}-${Date.now()}`,
                name: label,
                color: PREDEFINED_COLORS[(layers.length + idx) % PREDEFINED_COLORS.length],
                isVisible: true,
                isLocked: false
            }));
            
            setLayers(prev => {
               if(prev.length === 1 && prev[0].id === 'fg') return newLayers;
               return [...prev, ...newLayers];
            });
            
            if (newLayers.length > 0) setActiveLayerId(newLayers[0].id);
        }
    } finally {
        setIsAnalyzing(false);
    }
  };

  // If no image, show upload screen
  if (!imageSrc) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-6 max-w-lg w-full">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            SegmentAI
          </h1>
          <p className="text-gray-400 text-lg">
            Professional segmentation & background removal tool. 
            Upload an image to start annotating instances or separating foregrounds.
          </p>
          
          <div className="border-2 border-dashed border-gray-700 rounded-2xl p-12 hover:border-blue-500 transition-colors bg-gray-900/50">
            <Upload className="w-16 h-16 text-gray-500 mx-auto mb-4" />
            <label className="block">
              <Button size="lg" onClick={() => document.getElementById('file-upload')?.click()}>
                Select Image
              </Button>
              <input 
                id="file-upload" 
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleImageUpload}
              />
            </label>
            <p className="mt-4 text-sm text-gray-500">Drag & drop or click to upload</p>
          </div>
        </div>
      </div>
    );
  }

  // Main Editor Interface
  return (
    <div className="flex h-screen bg-gray-950 text-gray-200">
      
      {/* Left Toolbar */}
      <div className="w-16 bg-gray-900 border-r border-gray-800 flex flex-col items-center py-4 space-y-4 z-10">
        <div className="p-2 bg-gray-800 rounded-lg mb-4">
           <div className="w-6 h-6 rounded-full bg-blue-500"></div>
        </div>
        
        <ToolButton 
            active={tool === ToolType.BRUSH} 
            onClick={() => setTool(ToolType.BRUSH)} 
            icon={<Brush size={20} />} 
            label="Brush"
        />
        <ToolButton 
            active={tool === ToolType.MAGIC_WAND} 
            onClick={() => setTool(ToolType.MAGIC_WAND)} 
            icon={<Sparkles size={20} />} 
            label="Magic Wand"
        />
        <ToolButton 
            active={tool === ToolType.POLYGON} 
            onClick={() => setTool(ToolType.POLYGON)} 
            icon={<PenTool size={20} />} 
            label="Polygon"
        />
        <ToolButton 
            active={tool === ToolType.ERASER} 
            onClick={() => setTool(ToolType.ERASER)} 
            icon={<Eraser size={20} />} 
            label="Eraser"
        />
        <ToolButton 
            active={tool === ToolType.PAN} 
            onClick={() => setTool(ToolType.PAN)} 
            icon={<Move size={20} />} 
            label="Pan"
        />

        <div className="h-px w-8 bg-gray-700 my-2"></div>

        <div className="flex flex-col items-center gap-2">
            <button onClick={() => setZoom(z => Math.min(z + 0.1, 5))} className="p-2 hover:bg-gray-800 rounded">
                <ZoomIn size={18} />
            </button>
            <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.1))} className="p-2 hover:bg-gray-800 rounded">
                <ZoomOut size={18} />
            </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
            <div className="flex items-center gap-4">
                <h2 className="font-semibold text-white">Editor</h2>
                
                {/* Undo / Redo */}
                <div className="flex items-center bg-gray-800 rounded-lg p-1 gap-1 ml-4">
                    <button 
                        onClick={handleUndo} 
                        disabled={historyPast.length === 0}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Undo (Ctrl+Z)"
                    >
                        <RotateCcw size={16} />
                    </button>
                    <button 
                        onClick={handleRedo} 
                        disabled={historyFuture.length === 0}
                        className="p-1.5 hover:bg-gray-700 rounded text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Redo (Ctrl+Y)"
                    >
                        <RotateCw size={16} />
                    </button>
                </div>

                <div className="h-6 w-px bg-gray-800 mx-2"></div>

                {(tool === ToolType.BRUSH || tool === ToolType.ERASER) && (
                    <div className="flex items-center gap-2 bg-gray-800 rounded-full px-3 py-1">
                        <span className="text-xs font-medium text-gray-400">Size</span>
                        <input 
                            type="range" 
                            min="1" 
                            max="100" 
                            value={brushSize} 
                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                            className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-xs w-6">{brushSize}px</span>
                    </div>
                )}
                {tool === ToolType.MAGIC_WAND && (
                    <div className="flex items-center gap-2 bg-gray-800 rounded-full px-3 py-1">
                        <span className="text-xs font-medium text-gray-400">Tolerance</span>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={tolerance} 
                            onChange={(e) => setTolerance(parseInt(e.target.value))}
                            className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-xs w-6">{tolerance}</span>
                    </div>
                )}
            </div>
            
            <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setImageSrc(null)}>
                    <X size={16} className="mr-2"/> Close
                </Button>
                <div className="h-6 w-px bg-gray-700 mx-2"></div>
                <Button variant="secondary" size="sm" onClick={() => handleExport('white_bg')}>
                    <Download size={16} className="mr-2"/> Export (White)
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleExport('rgba')}>
                    <Download size={16} className="mr-2"/> Export (Transp.)
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleExport('training_mask')}>
                    <Download size={16} className="mr-2"/> Training Mask (ID)
                </Button>
                 <Button variant="primary" size="sm" onClick={() => handleExport('visual_mask')}>
                    <Download size={16} className="mr-2"/> Visual Mask
                </Button>
            </div>
        </header>

        {/* Canvas Area */}
        <div className="flex-1 relative overflow-hidden bg-gray-950">
            <CanvasEditor 
                imageSrc={imageSrc}
                activeLayerId={activeLayerId}
                layers={layers}
                tool={tool}
                brushSize={brushSize}
                tolerance={tolerance}
                zoom={zoom}
                onSnapshot={handleSnapshot}
                restoredMasks={restoredMasks}
                requestExport={isExporting}
                onExportComplete={handleExportComplete}
                exportMode={exportMode}
            />
        </div>
      </div>

      {/* Right Sidebar - Layers */}
      <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col z-10">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            <h3 className="font-medium text-gray-200 flex items-center gap-2">
                <Layers size={18} /> Layers / Instances
            </h3>
            <button onClick={() => addLayer()} className="p-1 hover:bg-gray-800 rounded text-blue-400">
                <Plus size={20} />
            </button>
        </div>

        {/* AI Suggestion Area */}
        <div className="p-3 border-b border-gray-800 bg-gray-800/30">
            <Button 
                variant="secondary" 
                size="sm" 
                className="w-full justify-center text-purple-400 border-purple-900/50 hover:bg-purple-900/20"
                onClick={runAIDetection}
                isLoading={isAnalyzing}
            >
                <Wand2 size={16} className="mr-2" /> 
                {isAnalyzing ? "Analyzing..." : "Auto-Detect Labels"}
            </Button>
            <p className="text-[10px] text-gray-500 mt-2 text-center">
                Uses Gemini 2.5 Flash to identify objects
            </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {layers.map(layer => (
                <div 
                    key={layer.id}
                    onClick={() => setActiveLayerId(layer.id)}
                    className={`
                        group flex items-center gap-2 p-2 rounded-lg cursor-pointer border
                        ${activeLayerId === layer.id 
                            ? 'bg-blue-900/20 border-blue-500/50' 
                            : 'hover:bg-gray-800 border-transparent'}
                    `}
                >
                    <div className="relative w-4 h-4 rounded-full flex-shrink-0 overflow-hidden cursor-pointer hover:ring-1 hover:ring-white">
                        <input 
                            type="color" 
                            value={layer.color}
                            onChange={(e) => updateLayer(layer.id, { color: e.target.value })}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 border-0 cursor-pointer"
                        />
                    </div>
                    
                    <input 
                        type="text"
                        value={layer.name}
                        onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                        className={`flex-1 text-sm bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 truncate ${activeLayerId === layer.id ? 'text-white' : 'text-gray-400'}`}
                        onClick={(e) => e.stopPropagation()} 
                    />

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                            className="p-1 text-gray-500 hover:text-white"
                            onClick={(e) => { e.stopPropagation(); toggleVisibility(layer.id); }}
                        >
                            {layer.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button 
                            className="p-1 text-gray-500 hover:text-red-400"
                            onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{ active: boolean, onClick: () => void, icon: React.ReactNode, label: string }> = ({ 
    active, onClick, icon, label 
}) => (
    <button 
        onClick={onClick}
        className={`
            p-3 rounded-xl transition-all relative group
            ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}
        `}
    >
        {icon}
        <span className="absolute left-14 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
            {label}
        </span>
    </button>
);

export default App;