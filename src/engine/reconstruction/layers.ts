export type LayerId = 0 | 1 | 2;
export interface DepthLayers {
  width: number; height: number;
  labels: Uint8Array;
  /** Piksel başına ön/orta/arka ağırlıkları; toplamı 1. */
  weights: Float32Array;
  ratios: [number, number, number];
  thresholds: number[];
  masked: boolean;
}

/** Histogramda deterministik k-means; eşikler video sahnesinde EMA ile izlenebilir. */
export function inferLayers(depth: Float32Array, width: number, height: number,
  mask?: Float32Array, previous?: DepthLayers): DepthLayers {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1
    || depth.length!==width*height || (mask && mask.length!==depth.length)
    || !depth.every(v=>Number.isFinite(v) && v>=0 && v<=1)) throw new RangeError('Invalid layer input');
  const masked=!!mask?.some(v=>v>=.5), count=masked?2:3;
  const histogram=new Float64Array(256);
  for(let i=0;i<depth.length;i++) if(!masked || mask![i]<.5) histogram[Math.round(depth[i]*255)]++;
  const bins=Array.from(histogram.keys()).filter(i=>histogram[i]>0);
  const lo=bins[0]??0, hi=bins.at(-1)??lo;
  const centers=Array.from({length:count},(_,i)=>lo+(hi-lo)*(i+.5)/count);
  for(let iteration=0;iteration<16;iteration++) {
    const sum=new Float64Array(count), total=new Float64Array(count);
    for(const b of bins) {
      let c=0; for(let j=1;j<count;j++) if(Math.abs(b-centers[j])<Math.abs(b-centers[c])) c=j;
      sum[c]+=b*histogram[b]; total[c]+=histogram[b];
    }
    for(let j=0;j<count;j++) if(total[j]) centers[j]=sum[j]/total[j];
  }
  let thresholds=centers.slice(1).map((c,i)=>(c+centers[i])/510);
  if(previous?.masked===masked && previous.width===width && previous.height===height
    && previous.thresholds.length===thresholds.length
    && thresholds.every((t,i)=>Math.abs(t-previous.thresholds[i])<.2))
    thresholds=thresholds.map((t,i)=>previous.thresholds[i]*.9+t*.1);
  const labels=new Uint8Array(depth.length), weights=new Float32Array(depth.length*3);
  const ratios: [number,number,number]=[0,0,0];
  for(let i=0;i<depth.length;i++) {
    const d=depth[i], fg=masked?Math.max(0,Math.min(1,mask![i]||0)):0;
    let label: LayerId;
    if(masked && fg>=.5) label=0;
    else if(hi===lo) label=1;
    else if(masked) label=d>=thresholds[0]?1:2;
    else label=d>=thresholds[1]?0:d>=thresholds[0]?1:2;
    labels[i]=label; ratios[label]++;
    // Yalnız dar derinlik bandında yumuşat; komşu piksele yayma yok, keskin kenar korunur.
    if(masked) {
      const mid=hi===lo?1:smoothBand(d,thresholds[0]);
      weights[i*3]=fg; weights[i*3+1]=(1-fg)*mid; weights[i*3+2]=(1-fg)*(1-mid);
    } else if(hi===lo) weights[i*3+1]=1;
    else {
      const near=smoothBand(d,thresholds[1]), far=1-smoothBand(d,thresholds[0]);
      weights[i*3]=near; weights[i*3+1]=Math.max(0,1-near-far); weights[i*3+2]=far;
    }
  }
  for(let i=0;i<3;i++) ratios[i]/=depth.length;
  return {width,height,labels,weights,ratios,thresholds,masked};
}
function smoothBand(d:number,t:number) { const x=Math.max(0,Math.min(1,(d-t+.005)/.01)); return x*x*(3-2*x); }
function indexAt(l:DepthLayers,u:number,v:number) {
  return Math.max(0,Math.min(l.height-1,Math.floor(v*l.height)))*l.width
    +Math.max(0,Math.min(l.width-1,Math.floor(u*l.width)));
}
export function layerWeightAt(l:DepthLayers,u:number,v:number,visible:readonly number[]) {
  const i=indexAt(l,u,v)*3; return l.weights[i]*visible[0]+l.weights[i+1]*visible[1]+l.weights[i+2]*visible[2];
}
/** Konum dizisini yalnız açıkken değiştirir; alfa ve katman içi derinlik korunur. */
export function applyLayerGap(positions:Float32Array, grid:number, layers:DepthLayers, gap:number) {
  if(!Number.isFinite(gap)||gap<0) throw new RangeError('Invalid layer gap');
  if(gap===0) return;
  for(let j=0;j<grid;j++) for(let i=0;i<grid;i++)
    positions[(j*grid+i)*4+2]+=(1-layers.labels[indexAt(layers,(i+.5)/grid,(j+.5)/grid)])*gap;
}
export function applyShellLayerGap(positions:Float32Array,uvs:Float32Array,layers:DepthLayers,gap:number) {
  if(!Number.isFinite(gap)||gap<0) throw new RangeError('Invalid layer gap');
  if(gap===0) return;
  for(let i=0;i<positions.length/3;i++) positions[i*3+2]+=(1-layers.labels[indexAt(layers,uvs[i*2],1-uvs[i*2+1])])*gap;
}

/** Ayrılan katmanları bağlayan üçgenler boşluğu perdeye çevirmesin. */
export function layerShellIndices(indices:Uint32Array,uvs:Float32Array,layers:DepthLayers):Uint32Array {
  const labels=new Uint8Array(uvs.length/2);
  for(let i=0;i<labels.length;i++) labels[i]=layers.labels[indexAt(layers,uvs[i*2],1-uvs[i*2+1])];
  const kept:number[]=[];
  for(let i=0;i<indices.length;i+=3) {
    const a=indices[i], b=indices[i+1], c=indices[i+2];
    if(labels[a]===labels[b] && labels[b]===labels[c]) kept.push(a,b,c);
  }
  return Uint32Array.from(kept);
}
