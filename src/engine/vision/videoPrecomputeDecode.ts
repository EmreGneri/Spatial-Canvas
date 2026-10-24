/** Demuxed WebCodecs iteration decodes every source frame, independent of display refresh. */
export async function decodeVideoDepthSource(file: Blob, width: number, height: number, signal: AbortSignal,
  metadata: (duration: number) => Promise<void>, save: (time: number, pixels: Uint8ClampedArray) => Promise<void>): Promise<void> {
  signal.throwIfAborted();
  // Existing Apache/MIT licensed bundled media runtime, also used by the video importer.
  // @ts-expect-error The vendored JavaScript bundle has no TypeScript declarations.
  const mb = await import('../../vendor/splat.js/vendor/mediabunny.min.mjs');
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
  const abort = () => input.dispose();
  signal.addEventListener('abort', abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { clearTimeout(timeout); timeout = setTimeout(() => input.dispose(), 30_000); };
  try {
    arm(); signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw Error('Video codec cannot be decoded locally; using V2.');
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw Error('Video duration unavailable');
    const rotation = await track.getRotation();
    const sourceWidth = await track.getSquarePixelWidth(), sourceHeight = await track.getSquarePixelHeight();
    const aspect = rotation % 180 ? sourceHeight / sourceWidth : sourceWidth / sourceHeight;
    if (Math.abs(aspect / (width / height) - 1) > 0.15) throw Error('Offline VDA export aspect ratio unsupported; using V2.');
    await metadata(duration);
    const sink = new mb.CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
    let last = -Infinity;
    for await (const frame of sink.canvases()) {
      signal.throwIfAborted(); arm();
      if (!Number.isFinite(frame.timestamp) || frame.timestamp <= last) throw Error('Non-monotonic source timestamps');
      const context = frame.canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw Error('Video canvas unavailable');
      await save(frame.timestamp, context.getImageData(0, 0, width, height).data);
      last = frame.timestamp;
    }
    signal.throwIfAborted();
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); input.dispose(); }
}
