/** Use a non-passive listener so zooming the training canvas never scrolls the page. */
export function bindWheelZoom(
  canvas: HTMLCanvasElement,
  zoom: (factor: number) => void,
): () => void {
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    if (event.deltaY === 0) return;
    const pixels = event.deltaY * (
      event.deltaMode === 1 ? 16 :
      event.deltaMode === 2 ? canvas.clientHeight : 1
    );
    zoom(Math.exp(Math.max(-2, Math.min(2, pixels * 0.0015))));
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => canvas.removeEventListener('wheel', onWheel);
}

/** Keep the camera outside the pivot and within a navigable distance. */
export function boundedZoomFactor(distance: number, homeDistance: number, requested: number): number {
  if (!(distance > 0) || !(homeDistance > 0) || !Number.isFinite(requested)) return 1;
  const next = Math.max(homeDistance * 0.03, Math.min(homeDistance * 30, distance * requested));
  return next / distance;
}
