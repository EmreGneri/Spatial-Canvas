/** Give a visible preview two frame opportunities without suspending final work in background tabs. */
export function waitForPhotoPresentation(
  maxWaitMs = 250,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden',
): Promise<void> {
  if (hidden) return Promise.resolve();
  return new Promise(resolve => {
    let frame: number | undefined;
    const finish = () => {
      clearTimeout(timer);
      if (frame !== undefined) cancelFrame(frame);
      resolve();
    };
    const timer = setTimeout(finish, maxWaitMs);
    try { frame = requestFrame(() => { frame = requestFrame(finish); }); }
    catch { finish(); }
  });
}
