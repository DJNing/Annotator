export interface Point {
  x: number;
  y: number;
}

export enum ToolType {
  BRUSH = 'BRUSH',
  ERASER = 'ERASER',
  PAN = 'PAN',
  POLYGON = 'POLYGON',
  MAGIC_WAND = 'MAGIC_WAND'
}

export interface SegmentationLayer {
  id: string;
  name: string;
  color: string; // Hex color for visualization
  isVisible: boolean;
  isLocked: boolean;
  // We store mask data as a base64 string or keep it in a canvas ref in runtime. 
  // For this state, we just track metadata.
}

export type MaskState = Record<string, string>; // LayerId -> DataURL

export interface AppState {
  imageSrc: string | null;
  imageWidth: number;
  imageHeight: number;
  scale: number;
  pan: Point;
}

export const BRUSH_SIZES = [5, 10, 20, 40, 80];

export const PREDEFINED_COLORS = [
  '#ef4444', // Red
  '#22c55e', // Green
  '#3b82f6', // Blue
  '#eab308', // Yellow
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
];