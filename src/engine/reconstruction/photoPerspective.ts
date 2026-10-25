import type { MetricPhotoGeometry, MetricPhotoProjection } from './metricPhotoGeometry.ts';

export interface PhotoCameraInput {
  intrinsics?: Float64Array;
  focal35?: number;
  selfie?: boolean;
}

/** Deneysel yol: kabul ölçümleri geçmeden varsayılan yapılmaz. */
export function photoPerspectiveEnabled(search: string): boolean {
  return new URLSearchParams(search).get('izdusum') === 'perspektif';
}

export function selectPhotoIntrinsics(width: number, height: number, input: PhotoCameraInput) {
  const k = input.intrinsics;
  if (k?.length === 9 && Array.from(k).every(Number.isFinite) && k[0] > 0 && k[4] > 0
    && k[1] === 0 && k[3] === 0 && k[6] === 0 && k[7] === 0 && k[8] === 1) {
    return { intrinsics: k.slice(), source: 'moge' as const };
  }
  const exif = Number.isFinite(input.focal35) && input.focal35! >= 8 && input.focal35! <= 300;
  // 35 mm eşdeğeri diyagonal tanımlıdır; mevcut EXIF okuyucusuyla aynı sözleşme.
  const focalPx = exif ? input.focal35! * Math.hypot(width, height) / 43.27
    : width / (2 * Math.tan((input.selfie ? 78 : 68) * Math.PI / 360));
  return { intrinsics: Float64Array.from([focalPx / width,0,.5,0,focalPx / height,.5,0,0,1]),
    source: exif ? 'exif' as const : 'default' as const };
}

/** Normalize edilmemiş disparite: ekrandaki sanatsal 0..1 derinlikten mesafe üretilmez. */
export function relativePhotoGeometry(
  disparity: Float32Array, width: number, height: number, camera: PhotoCameraInput,
): MetricPhotoGeometry {
  if (width < 2 || height < 2 || disparity.length !== width * height) throw new RangeError('Invalid relative photo dimensions');
  const values = Array.from(disparity).filter(v => Number.isFinite(v) && v > 0).sort((a,b)=>a-b);
  if (!values.length) throw new RangeError('No valid relative photo depth');
  const median = values[values.length >> 1];
  const depth = new Float32Array(disparity.length), validMask = new Uint8Array(depth.length);
  for (let i=0;i<depth.length;i++) {
    const d = disparity[i];
    if (!(Number.isFinite(d) && d > 0)) continue;
    depth[i] = 1 / Math.max(median / 8, d);
    validMask[i] = 1;
  }
  return { depth, width, height, validMask, intrinsics: selectPhotoIntrinsics(width,height,camera).intrinsics, captureCamera: true };
}

/** Aynı benzerlik dönüşümünün kamera merkezi; başlangıç görünüşünde ışınlar fotoğrafa oturur. */
export function photoReferenceCamera(projection: MetricPhotoProjection, g: MetricPhotoGeometry, viewportAspect: number) {
  const { intrinsics:k, width:w, height:h } = g;
  const aspect = w/h;
  // Eski fotoğraf düzleminin 2 birim yüksekliğini, 60°/3.5 kamera çerçevesinde koru.
  const frameHeight = 1/(3.5*Math.tan(Math.PI/6)) * Math.min(1,viewportAspect/aspect);
  const frameWidth = frameHeight*aspect/viewportAspect;
  const position = projection.center.map(c=>-c*projection.scale) as [number,number,number];
  return { position, target: [position[0],position[1],0] as [number,number,number],
    fov: 2*Math.atan(1/(2*k[4]*frameHeight))*180/Math.PI,
    offsetX: (.5-k[2])*frameWidth, offsetY: (.5-k[5])*frameHeight, frameWidth, frameHeight };
}
