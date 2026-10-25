import type { MetricPhotoGeometry, MetricPhotoProjection } from './metricPhotoGeometry.ts';

export interface PhotoCameraInput {
  intrinsics?: Float64Array;
  focal35?: number;
  selfie?: boolean;
  /** Ölçek tahmini için iki yanak noktası (kaynak görüntüye normalize). */
  face?: readonly [{ x: number; y: number }, { x: number; y: number }];
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
  calibration: { shift?: number; mask?: Float32Array } = {},
): MetricPhotoGeometry {
  if (width < 2 || height < 2 || disparity.length !== width * height) throw new RangeError('Invalid relative photo dimensions');
  if (calibration.mask && calibration.mask.length !== disparity.length) throw new RangeError('Invalid photo calibration mask');
  const shift = calibration.shift ?? 0;
  if (!Number.isFinite(shift) || shift < 0) throw new RangeError('Invalid photo disparity shift');
  const values: number[] = [], foreground: number[] = [];
  for (let i=0;i<disparity.length;i++) {
    const d=disparity[i], z=1/d-shift;
    if (!(Number.isFinite(d) && d>0 && Number.isFinite(z) && z>0)) continue;
    values.push(z);
    if (calibration.mask && calibration.mask[i]>=.5) foreground.push(z);
  }
  if (!values.length) throw new RangeError('No valid relative photo depth');
  const reference=foreground.length ? foreground : values;
  reference.sort((a,b)=>a-b);
  const median = reference[reference.length >> 1];
  const intrinsics=selectPhotoIntrinsics(width,height,camera).intrinsics;
  const depth = new Float32Array(disparity.length), validMask = new Uint8Array(depth.length);
  for (let i=0;i<depth.length;i++) {
    const d = disparity[i];
    const z=1/d-shift;
    if (!(Number.isFinite(d) && d > 0 && Number.isFinite(z) && z > 0)) continue;
    depth[i] = Math.min(8*median,Math.max(.02*median,z));
    validMask[i] = 1;
  }
  // 14.5 cm bir varsayım, ölçülmüş metrik gerçeklik değil. Tek skala şekli değiştirmez.
  if (camera.face) {
    const point = (p: {x:number;y:number}) => {
      if (![p.x,p.y].every(Number.isFinite) || p.x<0 || p.x>1 || p.y<0 || p.y>1) return null;
      const i=Math.min(height-1,Math.floor(p.y*height))*width+Math.min(width-1,Math.floor(p.x*width));
      if (!validMask[i]) return null;
      const z=depth[i];
      return [(p.x-intrinsics[2])*z/intrinsics[0],(p.y-intrinsics[5])*z/intrinsics[4],z];
    };
    const left=point(camera.face[0]),right=point(camera.face[1]);
    if (left && right) {
      const faceWidth=Math.hypot(...left.map((v,i)=>v-right[i]));
      if (faceWidth>median*.01 && faceWidth<median*2) {
        const scale=.145/faceWidth;
        for(let i=0;i<depth.length;i++) depth[i]*=scale;
      }
    }
  }
  return { depth, width, height, validMask, intrinsics, captureCamera: true };
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
