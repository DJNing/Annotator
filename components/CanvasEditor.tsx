import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Point, ToolType, SegmentationLayer, MaskState } from '../types';

interface CanvasEditorProps {
  imageSrc: string;
  activeLayerId: string;
  layers: SegmentationLayer[];
  tool: ToolType;
  brushSize: number;
  tolerance: number;
  zoom: number;
  onSnapshot: (masks: MaskState) => void; 
  restoredMasks: MaskState | null;
  requestExport: boolean;
  onExportComplete: (dataUrl: string) => void;
  exportMode: 'rgba' | 'visual_mask' | 'training_mask' | 'instance' | 'white_bg';
}

export const CanvasEditor: React.FC<CanvasEditorProps> = ({
  imageSrc,
  activeLayerId,
  layers,
  tool,
  brushSize,
  tolerance,
  zoom,
  onSnapshot,
  restoredMasks,
  requestExport,
  onExportComplete,
  exportMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  // Canvas refs
  const displayCanvasRef = useRef<HTMLCanvasElement>(null); // What the user sees
  const maskCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map()); // Offscreen canvases per layer

  // Source image data for magic wand
  const sourceImageDataRef = useRef<ImageData | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPoint, setLastPoint] = useState<Point | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);

  // Polygon State
  const [polyPoints, setPolyPoints] = useState<Point[]>([]);
  const [cursorPos, setCursorPos] = useState<Point | null>(null); // For rubber banding

  // Helper to capture current state of all masks
  const captureSnapshot = useCallback(() => {
    const snapshot: MaskState = {};
    maskCanvasesRef.current.forEach((canvas, id) => {
        snapshot[id] = canvas.toDataURL();
    });
    layers.forEach(l => {
        if (!snapshot[l.id] && dimensions.width > 0) {
            snapshot[l.id] = ''; 
        }
    });
    onSnapshot(snapshot);
  }, [layers, dimensions, onSnapshot]);

  // Initialize Image
  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.crossOrigin = "anonymous";
    img.onload = () => {
      maskCanvasesRef.current.clear();
      setPolyPoints([]);
      sourceImageDataRef.current = null;

      setDimensions({ width: img.width, height: img.height });
      imageRef.current = img;
      
      const tempC = document.createElement('canvas');
      tempC.width = img.width;
      tempC.height = img.height;
      const ctx = tempC.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        try {
          sourceImageDataRef.current = ctx.getImageData(0, 0, img.width, img.height);
        } catch (e) {
          console.warn("Cannot get image data (likely CORS)", e);
        }
      }

      layers.forEach(layer => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        maskCanvasesRef.current.set(layer.id, c);
      });
    };
  }, [imageSrc]); 

  // Ensure masks exist for all layers
  useEffect(() => {
    if (dimensions.width === 0) return;
    layers.forEach(layer => {
       if (!maskCanvasesRef.current.has(layer.id)) {
          const c = document.createElement('canvas');
          c.width = dimensions.width;
          c.height = dimensions.height;
          maskCanvasesRef.current.set(layer.id, c);
       }
    });
  }, [layers, dimensions]);

  // Handle Restoration
  useEffect(() => {
    if (restoredMasks && dimensions.width > 0 && dimensions.height > 0) {
        maskCanvasesRef.current.forEach(ctx => {
            const context = ctx.getContext('2d');
            if(context) context.clearRect(0, 0, dimensions.width, dimensions.height);
        });

        Object.entries(restoredMasks).forEach(([layerId, value]) => {
            const dataUrl = value as string;
            if (!dataUrl) return; 
            
            let canvas = maskCanvasesRef.current.get(layerId);
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.width = dimensions.width;
                canvas.height = dimensions.height;
                maskCanvasesRef.current.set(layerId, canvas);
            }

            const img = new Image();
            img.onload = () => {
                const ctx = canvas!.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    render(); 
                }
            };
            img.src = dataUrl;
        });
        render();
    }
  }, [restoredMasks, dimensions]);

  const render = useCallback(() => {
    const canvas = displayCanvasRef.current;
    const img = imageRef.current;
    
    if (!canvas || !img || dimensions.width === 0 || dimensions.height === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // 0. Draw White Background (for transparent images)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, img.width, img.height);

    // 1. Draw Original Image
    ctx.drawImage(img, 0, 0);

    // 2. Draw all Visible Masks
    layers.forEach(layer => {
      if (!layer.isVisible) return;
      const maskCanvas = maskCanvasesRef.current.get(layer.id);
      if (maskCanvas) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        
        const tempC = document.createElement('canvas');
        tempC.width = dimensions.width;
        tempC.height = dimensions.height;
        
        const tempCtx = tempC.getContext('2d');
        if(tempCtx) {
            tempCtx.drawImage(maskCanvas, 0, 0);
            tempCtx.globalCompositeOperation = 'source-in';
            tempCtx.fillStyle = layer.color;
            tempCtx.fillRect(0, 0, tempC.width, tempC.height);
            
            if (tempC.width > 0 && tempC.height > 0) {
                ctx.drawImage(tempC, 0, 0);
            }
        }
        ctx.restore();
      }
    });

    // 3. Draw active polygon
    if (polyPoints.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#FFFF00';
        ctx.lineWidth = 2 / zoom;
        ctx.fillStyle = '#FFFF00';
        
        ctx.beginPath();
        ctx.moveTo(polyPoints[0].x, polyPoints[0].y);
        for (let i = 1; i < polyPoints.length; i++) {
            ctx.lineTo(polyPoints[i].x, polyPoints[i].y);
        }
        if (cursorPos) {
            ctx.lineTo(cursorPos.x, cursorPos.y);
        }
        ctx.stroke();

        for (const p of polyPoints) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2);
            ctx.fill();
        }
        
        if (polyPoints.length > 2 && cursorPos) {
            const start = polyPoints[0];
            const dist = Math.sqrt(Math.pow(start.x - cursorPos.x, 2) + Math.pow(start.y - cursorPos.y, 2));
            if (dist < 10 / zoom) {
                 ctx.beginPath();
                 ctx.strokeStyle = '#00FF00';
                 ctx.arc(start.x, start.y, 6 / zoom, 0, Math.PI * 2);
                 ctx.stroke();
            }
        }
        ctx.restore();
    }

    ctx.restore();
  }, [layers, dimensions, zoom, pan, polyPoints, cursorPos]);

  useEffect(() => {
    render();
  }, [render]);


  const getPointerPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    if (!displayCanvasRef.current) return { x: 0, y: 0 };
    const rect = displayCanvasRef.current.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }
    const x = (clientX - rect.left - pan.x) / zoom;
    const y = (clientY - rect.top - pan.y) / zoom;
    return { x, y };
  };

  const performFloodFill = (startX: number, startY: number) => {
    if (!sourceImageDataRef.current) return;
    const srcData = sourceImageDataRef.current.data;
    const width = dimensions.width;
    const height = dimensions.height;
    
    startX = Math.floor(startX);
    startY = Math.floor(startY);

    if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

    // Get Start Color
    const startIdx = (startY * width + startX) * 4;
    const r0 = srcData[startIdx];
    const g0 = srcData[startIdx + 1];
    const b0 = srcData[startIdx + 2];
    
    const tol = tolerance * 2.55; 

    const colorMatch = (idx: number) => {
        const r = srcData[idx];
        const g = srcData[idx + 1];
        const b = srcData[idx + 2];
        return Math.abs(r - r0) <= tol && Math.abs(g - g0) <= tol && Math.abs(b - b0) <= tol;
    };

    const visited = new Uint8Array(width * height);
    const stack = [startIdx];
    visited[startIdx / 4] = 1;

    const maskCanvas = maskCanvasesRef.current.get(activeLayerId);
    if (!maskCanvas) return;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;
    
    const maskImgData = maskCtx.getImageData(0, 0, width, height);
    const maskData = maskImgData.data;
    const stride = width * 4;

    while (stack.length > 0) {
        const idx = stack.pop()!;
        
        maskData[idx] = 255;   
        maskData[idx+1] = 255; 
        maskData[idx+2] = 255; 
        maskData[idx+3] = 255; 
        
        const x = (idx / 4) % width;
        const y = Math.floor((idx / 4) / width);

        if (x < width - 1) {
            const nIdx = idx + 4;
            if (!visited[nIdx / 4] && colorMatch(nIdx)) {
                visited[nIdx / 4] = 1;
                stack.push(nIdx);
            }
        }
        if (x > 0) {
            const nIdx = idx - 4;
            if (!visited[nIdx / 4] && colorMatch(nIdx)) {
                visited[nIdx / 4] = 1;
                stack.push(nIdx);
            }
        }
        if (y < height - 1) {
            const nIdx = idx + stride;
            if (!visited[nIdx / 4] && colorMatch(nIdx)) {
                visited[nIdx / 4] = 1;
                stack.push(nIdx);
            }
        }
        if (y > 0) {
            const nIdx = idx - stride;
            if (!visited[nIdx / 4] && colorMatch(nIdx)) {
                visited[nIdx / 4] = 1;
                stack.push(nIdx);
            }
        }
    }

    maskCtx.putImageData(maskImgData, 0, 0);
    captureSnapshot();
    render();
  };

  const commitPolygon = useCallback(() => {
    if (polyPoints.length < 3) {
        setPolyPoints([]);
        return;
    }
    const maskCanvas = maskCanvasesRef.current.get(activeLayerId);
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(polyPoints[0].x, polyPoints[0].y);
    for (let i = 1; i < polyPoints.length; i++) {
        ctx.lineTo(polyPoints[i].x, polyPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.restore();

    setPolyPoints([]);
    captureSnapshot();
    render();
  }, [polyPoints, activeLayerId, captureSnapshot, render]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (tool !== ToolType.POLYGON) return;
        if (e.key === 'Enter') commitPolygon();
        else if (e.key === 'Escape') setPolyPoints([]);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tool, commitPolygon]);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.target === displayCanvasRef.current) e.preventDefault();
    
    if (tool === ToolType.PAN) {
        setIsPanning(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        setPanStart({ x: clientX - pan.x, y: clientY - pan.y });
        return;
    }

    const pos = getPointerPos(e);

    if (tool === ToolType.MAGIC_WAND) {
        performFloodFill(pos.x, pos.y);
        return; 
    }

    if (tool === ToolType.POLYGON) {
        if (polyPoints.length > 2) {
            const start = polyPoints[0];
            const dist = Math.sqrt(Math.pow(start.x - pos.x, 2) + Math.pow(start.y - pos.y, 2));
            if (dist < 10 / zoom) {
                commitPolygon();
                return;
            }
        }
        setPolyPoints(prev => [...prev, pos]);
        return;
    }

    setIsDrawing(true);
    setLastPoint(pos);
    draw(pos, pos);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isDrawing || isPanning || tool === ToolType.POLYGON) e.preventDefault();
    
    if (isPanning && panStart) {
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        setPan({ x: clientX - panStart.x, y: clientY - panStart.y });
        return;
    }

    const pos = getPointerPos(e);

    if (tool === ToolType.POLYGON) {
        setCursorPos(pos);
        return;
    }

    if (!isDrawing || !lastPoint) return;
    draw(lastPoint, pos);
    setLastPoint(pos);
  };

  const handlePointerUp = () => {
    if (tool === ToolType.POLYGON || tool === ToolType.MAGIC_WAND) return;

    if (isDrawing) {
        captureSnapshot();
    }
    
    setIsDrawing(false);
    setLastPoint(null);
    setIsPanning(false);
    setPanStart(null);
  };

  const draw = (start: Point, end: Point) => {
    const maskCanvas = maskCanvasesRef.current.get(activeLayerId);
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize; 
    
    if (tool === ToolType.ERASER) {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#FFFFFF';
    }

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    render(); 
  };
  
  useEffect(() => {
    if (requestExport && dimensions.width > 0) {
        processExport();
    }
  }, [requestExport]);

  const processExport = () => {
    const img = imageRef.current;
    if (!img || dimensions.width === 0) return;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = dimensions.width;
    exportCanvas.height = dimensions.height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    // Helper to get composite mask (simple addition of all layers)
    const getCompositeMask = () => {
        const maskComposite = document.createElement('canvas');
        maskComposite.width = dimensions.width;
        maskComposite.height = dimensions.height;
        const mCtx = maskComposite.getContext('2d');
        if (mCtx) {
            layers.forEach(layer => {
                if (layer.isVisible) {
                    const lMask = maskCanvasesRef.current.get(layer.id);
                    if (lMask) mCtx.drawImage(lMask, 0, 0);
                }
            });
        }
        return maskComposite;
    };

    if (exportMode === 'white_bg') {
        // 1. Fill white
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, dimensions.width, dimensions.height);
        
        // 2. Prepare cut-out
        const cutoutCanvas = document.createElement('canvas');
        cutoutCanvas.width = dimensions.width;
        cutoutCanvas.height = dimensions.height;
        const cCtx = cutoutCanvas.getContext('2d');
        if (cCtx) {
            cCtx.drawImage(img, 0, 0);
            const mask = getCompositeMask();
            cCtx.globalCompositeOperation = 'destination-in';
            cCtx.drawImage(mask, 0, 0);
        }
        
        // 3. Draw cut-out on white
        ctx.drawImage(cutoutCanvas, 0, 0);
        onExportComplete(exportCanvas.toDataURL('image/png'));
    } 
    else if (exportMode === 'rgba') {
        ctx.drawImage(img, 0, 0);
        const maskComposite = getCompositeMask();
        ctx.globalCompositeOperation = 'destination-in';
        if (maskComposite.width > 0) ctx.drawImage(maskComposite, 0, 0);
        onExportComplete(exportCanvas.toDataURL('image/png'));
    } 
    else if (exportMode === 'instance') {
        // Similar to RGBA but highlights specific layers differently if needed
        // For now, implementing standard cutout
        ctx.drawImage(img, 0, 0);
        const maskComposite = document.createElement('canvas');
        maskComposite.width = dimensions.width;
        maskComposite.height = dimensions.height;
        const mCtx = maskComposite.getContext('2d');
        if (mCtx) {
            const activeMask = maskCanvasesRef.current.get(activeLayerId);
            const fgMask = maskCanvasesRef.current.get('fg');
            if (activeMask) {
                mCtx.drawImage(activeMask, 0, 0);
                if (activeLayerId !== 'fg' && fgMask) {
                    mCtx.globalCompositeOperation = 'destination-in';
                    mCtx.drawImage(fgMask, 0, 0);
                }
            }
            ctx.globalCompositeOperation = 'destination-in';
            if (maskComposite.width > 0) ctx.drawImage(maskComposite, 0, 0);
        }
        onExportComplete(exportCanvas.toDataURL('image/png'));
    } 
    else if (exportMode === 'training_mask') {
        // Export Instance IDs (Grayscale integers: 0=bg, 1=layer1, 2=layer2, etc.)
        // Ensure smoothing is off to preserve integer values
        ctx.imageSmoothingEnabled = false;

        // 1. Fill Background Black (ID 0)
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, dimensions.width, dimensions.height);

        // 2. Draw each layer with a specific color index
        // We use rgb(id, id, id) for grayscale representation
        layers.forEach((layer, index) => {
            if (!layer.isVisible) return;
            const lMask = maskCanvasesRef.current.get(layer.id);
            if (lMask) {
                ctx.save();
                // Layer ID starts at 1, because 0 is background
                const id = index + 1;
                ctx.fillStyle = `rgb(${id},${id},${id})`;
                
                // Draw the mask shape filled with the ID color
                const tempC = document.createElement('canvas');
                tempC.width = dimensions.width;
                tempC.height = dimensions.height;
                const tempCtx = tempC.getContext('2d');
                if (tempCtx) {
                    tempCtx.imageSmoothingEnabled = false;
                    tempCtx.drawImage(lMask, 0, 0);
                    tempCtx.globalCompositeOperation = 'source-in';
                    tempCtx.fillStyle = `rgb(${id},${id},${id})`;
                    tempCtx.fillRect(0, 0, tempC.width, tempC.height);
                    
                    if (tempC.width > 0) ctx.drawImage(tempC, 0, 0);
                }
                ctx.restore();
            }
        });

        // 3. Mask by Original Image Alpha
        // If the original image is transparent, the training mask should also be background (0)
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(img, 0, 0);

        // 4. Ensure we have a black background behind the transparency created by step 3
        // Because destination-in creates transparent pixels (rgba(0,0,0,0)), but training often wants solid black (rgba(0,0,0,255))
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = dimensions.width;
        finalCanvas.height = dimensions.height;
        const fCtx = finalCanvas.getContext('2d');
        if (fCtx) {
            fCtx.fillStyle = 'black';
            fCtx.fillRect(0, 0, dimensions.width, dimensions.height);
            fCtx.drawImage(exportCanvas, 0, 0);
        }

        onExportComplete(finalCanvas.toDataURL('image/png'));
    }
    else {
        // 'visual_mask' mode (Visual Overlay)
        
        // 1. Draw Masks with colors
        layers.forEach(layer => {
            if (!layer.isVisible) return;
            const lMask = maskCanvasesRef.current.get(layer.id);
            if (lMask) {
                ctx.save();
                // ctx.globalAlpha = 0.6; // We want full opacity for the exported mask usually, or keep it semi-transparent?
                // Usually export masks are solid colors on transparent BG. Let's make them solid but alpha masked.
                
                const tempC = document.createElement('canvas');
                tempC.width = dimensions.width;
                tempC.height = dimensions.height;
                const tempCtx = tempC.getContext('2d');
                if (tempCtx) {
                    tempCtx.drawImage(lMask, 0, 0);
                    tempCtx.globalCompositeOperation = 'source-in';
                    tempCtx.fillStyle = layer.color;
                    tempCtx.fillRect(0, 0, tempC.width, tempC.height);
                    if (tempC.width > 0) ctx.drawImage(tempC, 0, 0);
                }
                ctx.restore();
            }
        });

        // 2. Mask by Original Image Alpha
        // This ensures the visual mask respects the original image's boundaries/cutout
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(img, 0, 0);

        onExportComplete(exportCanvas.toDataURL('image/png'));
    }
  };

  return (
    <div 
        ref={containerRef} 
        className="relative w-full h-full overflow-hidden bg-gray-900 flex items-center justify-center cursor-crosshair touch-none"
    >
        <canvas 
            ref={displayCanvasRef}
            width={containerRef.current?.clientWidth || 800}
            height={containerRef.current?.clientHeight || 600}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            className="block"
        />
        {dimensions.width === 0 && (
            <div className="absolute text-gray-500">Loading Image...</div>
        )}
    </div>
  );
};