/**
 * Source-switch guard. `teardownSource` bumps the counter; every async source
 * path captures it at start and checks after each await. A slow old source
 * (camera permission prompt, photo inference, video decode) then bails out
 * instead of writing depth/settings over the newer source or leaking a stream.
 */
export function captureGeneration(counter: { current: number }): () => boolean {
  const mine = counter.current;
  return () => counter.current === mine;
}

/**
 * Log line for a file the browser could not open. The usual culprits are phone
 * formats: iPhone .MOV is HEVC (Chrome on Windows often cannot decode it) and
 * iPhone photos are HEIC (no browser decodes it). The raw error stays visible.
 */
export function sourceErrorMessage(file: { name: string; type: string }, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (file.type.startsWith('video/')) {
    return `HATA video: "${file.name}" oynatılamadı (${raw}) — tarayıcı bu kodeği çözemiyor olabilir; ` +
      `telefon .MOV'u (HEVC/H.265) ise H.264 MP4'e dönüştürüp tekrar dene`;
  }
  if (file.type.startsWith('image/')) {
    return `HATA görsel: "${file.name}" açılamadı (${raw}) — tarayıcı bu biçimi çözemiyor olabilir; ` +
      `HEIC ise JPG/PNG'ye dönüştürüp tekrar dene`;
  }
  return `HATA: ${raw}`;
}
