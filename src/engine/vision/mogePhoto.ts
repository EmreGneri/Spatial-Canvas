import type { DepthResult } from '../../depth.ts';
import type { MogeRawResult } from './mogeDepth.ts';
import { mogePointsToMetricDepth } from './mogeGeometry.ts';

/** Letterbox is removed only AFTER calibration in the model's image coordinates. */
export function mogePhotoResult(raw: MogeRawResult, rect: { x: number; y: number; w: number; h: number }): DepthResult {
  const { x, y, w, h } = rect;
  if (![x,y,w,h].every(Number.isInteger) || x < 0 || y < 0 || w < 2 || h < 2
    || x+w > raw.width || y+h > raw.height) throw new Error('Invalid MoGe photo crop');
  const mask = raw.mask.slice();
  for (let j = 0; j < raw.height; j++) for (let i = 0; i < raw.width; i++) {
    if (i < x || i >= x+w || j < y || j >= y+h) mask[j*raw.width+i] = 0;
  }
  const metric = mogePointsToMetricDepth(raw.points, raw.width, raw.height, raw.metricScale, mask);
  const depth = new Float32Array(w*h), validMask = new Uint8Array(w*h);
  const values: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const source = (j+y)*raw.width+i+x, target = j*w+i;
    depth[target] = metric.depth[source];
    validMask[target] = metric.validMask[source];
    if (validMask[target]) values.push(depth[target]);
  }
  values.sort((a,b) => a-b);
  if (values.length < 2) throw new Error('MoGe photo has insufficient valid depth');
  const near = values[Math.floor((values.length-1)*.01)];
  const far = values[Math.ceil((values.length-1)*.99)];
  const data = new Float32Array(w*h);
  for (let i = 0; i < data.length; i++) if (validMask[i]) {
    data[i] = far > near ? Math.max(0, Math.min(1, (far-depth[i])/(far-near))) : .5;
  }
  const K = metric.intrinsics.slice();
  K[0] *= raw.width/w; K[2] = (K[2]*raw.width-x)/w;
  K[4] *= raw.height/h; K[5] = (K[5]*raw.height-y)/h;
  return {
    data, width: w, height: h,
    metricGeometry: { depth, width: w, height: h, intrinsics: K, validMask },
    moge: { backend: raw.backend, focal: metric.focal, shift: metric.shift,
      projectionRmse: metric.projectionRmse, metricScale: raw.metricScale },
  };
}
