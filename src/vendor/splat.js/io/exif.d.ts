export function readExifFocal(file: Blob): Promise<{ f35?: number; fmm?: number; make?: string; model?: string } | null>;
export function focalPxFrom35(f35: number, width: number, height: number): number;
