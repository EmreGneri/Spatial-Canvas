// Synthetic static-scene diagnostics, not the published ScanNet/RAFT benchmark.
// TAE matches the prior repository pose+depth symmetric AbsRel definition.
// OPW proxy uses exact GT-induced backward flow, GT occlusion rejection and
// exp(-50 * RGB squared distance), averaging weighted depth L1 in scene metres.
function project(camera, target, x, y, z) {
  if (!(z > 0) || !Number.isFinite(z)) return null;
  const { R, t } = camera;
  const dx = (x + 0.5 - camera.cx) / camera.f * z - t[0];
  const dy = (y + 0.5 - camera.cy) / (camera.fy ?? camera.f) * z - t[1];
  const dz = z - t[2];
  const X = R[0]*dx + R[3]*dy + R[6]*dz;
  const Y = R[1]*dx + R[4]*dy + R[7]*dz;
  const Z = R[2]*dx + R[5]*dy + R[8]*dz;
  const Q = target.R, u = target.t;
  const tz = Q[6]*X + Q[7]*Y + Q[8]*Z + u[2];
  if (!(tz > 0)) return null;
  const px = target.f*(Q[0]*X + Q[1]*Y + Q[2]*Z + u[0])/tz + target.cx - 0.5;
  const py = (target.fy ?? target.f)*(Q[3]*X + Q[4]*Y + Q[5]*Z + u[1])/tz + target.cy - 0.5;
  return px >= -1e-6 && py >= -1e-6 && px <= target.w-1+1e-6 && py <= target.h-1+1e-6
    ? { x: Math.max(0, Math.min(target.w-1, px)), y: Math.max(0, Math.min(target.h-1, py)), z: tz } : null;
}

function sample(array, w, h, x, y, stride = 1, channel = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w-1, x0+1), y1 = Math.min(h-1, y0+1);
  const fx = x-x0, fy = y-y0;
  const a = array[(y0*w+x0)*stride+channel], b = array[(y0*w+x1)*stride+channel];
  const c = array[(y1*w+x0)*stride+channel], d = array[(y1*w+x1)*stride+channel];
  return ((1-fx)*a+fx*b)*(1-fy)+((1-fx)*c+fx*d)*fy;
}

export function temporalDepthMetrics(frames) {
  let tae = 0, taeSamples = 0, opw = 0, opwSamples = 0;
  const direction = (source, target) => {
    const a = source.camera, b = target.camera;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const q = project(a, b, x, y, source.depth[y*a.w+x]);
      if (!q) continue;
      const z = target.depth[Math.round(q.y)*b.w+Math.round(q.x)];
      if (z > 0 && Number.isFinite(z)) { tae += Math.abs(q.z-z)/z; taeSamples++; }
    }
  };
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i-1], current = frames[i];
    direction(previous, current); direction(current, previous);
    const a = current.camera, b = previous.camera;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const index = y*a.w+x;
      const q = project(a, b, x, y, current.gt[index]);
      if (!q) continue;
      const visibleDepth = previous.gt[Math.round(q.y)*b.w+Math.round(q.x)];
      if (!(visibleDepth > 0) || Math.abs(visibleDepth-q.z)/q.z > 0.02) continue;
      const warped = sample(previous.depth, b.w, b.h, q.x, q.y), depth = current.depth[index];
      if (!(warped > 0 && depth > 0) || !Number.isFinite(warped+depth)) continue;
      let rgbError = 0;
      for (let c = 0; c < 3; c++) rgbError += (current.rgb[index*3+c] - sample(previous.rgb, b.w, b.h, q.x, q.y, 3, c))**2;
      opw += Math.exp(-50*rgbError)*Math.abs(depth-warped); opwSamples++;
    }
  }
  return { tae: taeSamples ? tae/taeSamples : null, taeSamples,
    opwMeters: opwSamples ? opw/opwSamples : null, opwSamples };
}
