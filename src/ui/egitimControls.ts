import { kameraMerkezi, yorunge, type GsKamera } from '../engine/reconstruction/egitim3dgs.ts';

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

type Vec3 = [number, number, number];
export interface FlyAxes { forward: number; right: number; vertical: number }

/** Held `KeyboardEvent.code`s -> movement axes; opposite keys cancel. Q/E avoid Space/Shift, which scroll or select. */
export function flyAxes(keys: ReadonlySet<string>): FlyAxes {
  const axis = (plus: string, minus: string) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);
  return { forward: axis('KeyW', 'KeyS'), right: axis('KeyD', 'KeyA'), vertical: axis('KeyE', 'KeyQ') };
}

/**
 * Translate without rotating: forward/right follow the camera (R rows 2 and 0,
 * COLMAP x right, z forward), vertical follows world up so rising never drifts
 * sideways on a tilted view. The centre stays inside `radius` of `pivot`; a
 * camera already outside (orbit zooms out further) may only move inward, so
 * entering fly mode never snaps the pose.
 */
export function flyStep(k: GsKamera, axes: FlyAxes, distance: number, pivot: Vec3, radius: number, up: Vec3): GsKamera {
  const len = Math.hypot(axes.forward, axes.right, axes.vertical);
  if (!(len > 0) || !(distance > 0)) return k;
  const s = distance / len;
  const C = kameraMerkezi(k);
  const next = [0, 1, 2].map((i) =>
    C[i] + s * (axes.forward * k.R[6 + i] + axes.right * k.R[i] + axes.vertical * up[i]) - pivot[i]);
  const d = Math.hypot(...next);
  const limit = Math.max(radius, Math.hypot(C[0] - pivot[0], C[1] - pivot[1], C[2] - pivot[2]));
  const scale = d > limit ? limit / d : 1;
  const C2 = next.map((v, i) => pivot[i] + v * scale);
  const t = [0, 1, 2].map((r) => -(k.R[r * 3] * C2[0] + k.R[r * 3 + 1] * C2[1] + k.R[r * 3 + 2] * C2[2]));
  return { ...k, t };
}

/** FPS look: orbit around the camera's own centre; pitch that would pass `limit` or flip the view is dropped. */
export function lookAround(k: GsKamera, up: Vec3, yaw: number, pitch: number, limit = (85 * Math.PI) / 180): GsKamera {
  const C = kameraMerkezi(k);
  const next = yorunge(k, C, up, yaw, pitch);
  const n = Math.hypot(...up);
  const elevation = (m: GsKamera) => Math.asin(Math.max(-1, Math.min(1, (m.R[6] * up[0] + m.R[7] * up[1] + m.R[8] * up[2]) / n)));
  const upright = -(next.R[3] * up[0] + next.R[4] * up[1] + next.R[5] * up[2]) > 0;
  const e = Math.abs(elevation(next));
  return upright && (e <= limit || e <= Math.abs(elevation(k))) ? next : yorunge(k, C, up, yaw, 0);
}

/** Room to explore the reconstruction, capped at the orbit zoom-out limit so switching modes never snaps. */
export function flyRadius(homeDistance: number, sceneRadius: number): number {
  return Math.min(homeDistance * 30, Math.max(homeDistance * 2, sceneRadius * 1.5));
}
