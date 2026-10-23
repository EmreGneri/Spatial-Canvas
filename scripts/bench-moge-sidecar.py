"""Real MoGe probe: explicit provider, no automatic DML-to-CPU session fallback.
Run: python scripts/bench-moge-sidecar.py [--cpu] [--model path] [--reference path]
"""
import argparse
import gc
import json
import sys
import time
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image
ROOT = Path(__file__).resolve().parent.parent

def run(path, x, provider, optimization, load_only=False):
    so = ort.SessionOptions()
    so.log_severity_level = 3
    so.enable_mem_pattern = False
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.intra_op_num_threads = 4
    so.graph_optimization_level = (ort.GraphOptimizationLevel.ORT_DISABLE_ALL if optimization == 'disabled' else ort.GraphOptimizationLevel.ORT_ENABLE_BASIC)
    for name, value in {'batch_size':1,'height':518,'width':518}.items():
        so.add_free_dimension_override_by_name(name,value)
    print(f'Creating {path.name}: {provider}, optimizer={optimization}', flush=True)
    start = time.perf_counter()
    session = ort.InferenceSession(str(path),so,providers=[provider],enable_fallback=False,disabled_optimizers=['SimplifiedLayerNormFusion','LayerNormFusion'])
    session.disable_fallback()
    meta = {'sessionMs':(time.perf_counter()-start)*1000,'actualProviders':session.get_providers(),'inputNames':[v.name for v in session.get_inputs()],'timesMs':[]}
    print(json.dumps(meta),flush=True)
    if load_only:
        return meta,None
    feeds={'image':x}
    if 'num_tokens' in meta['inputNames']:
        feeds['num_tokens']=np.array(1800,dtype=np.int64)
    for index in range(2):
        start=time.perf_counter()
        scale_name='metric_scale' if 'metric_scale' in [v.name for v in session.get_outputs()] else 'scale'
        points,mask,scale=session.run(['points','mask',scale_name],feeds)
        meta['timesMs'].append((time.perf_counter()-start)*1000)
        if points.shape!=(1,518,518,3) or mask.shape!=(1,518,518):
            raise ValueError('Unexpected MoGe output shape')
        value=float(scale.reshape(-1)[0])
        if not all(np.isfinite(v).all() for v in [points,mask,scale]) or value<=0:
            raise ValueError('Nonfinite output or nonpositive metric scale')
        output=np.concatenate([points.transpose(0,3,1,2),mask[:,None],np.full((1,1,518,518),value,np.float32)],axis=1).astype(np.float32)
        print(f'Call {index}: {meta["timesMs"][-1]:.1f}ms',flush=True)
    meta.update({'output':list(output.shape),'scale':value,'validFraction':float((mask>.5).mean())})
    del session
    gc.collect()
    return meta,output

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cpu',action='store_true')
    parser.add_argument('--model',type=Path,default=ROOT/'sidecar/models/moge-2-vitl-normal.onnx')
    parser.add_argument('--reference',type=Path)
    parser.add_argument('--reference-optimization',choices=['basic','disabled'])
    parser.add_argument('--optimization',choices=['basic','disabled'],default='basic')
    parser.add_argument('--load-only',action='store_true')
    parser.add_argument('--output',type=Path,default=ROOT/'olcum-out/moge-sidecar')
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    provider='CPUExecutionProvider' if args.cpu else 'DmlExecutionProvider'
    report={'requestedProvider':provider,'automaticProviderFallback':False,'model':str(args.model.resolve()),'optimization':args.optimization,'input':[1,3,518,518],'onnxruntime':ort.__version__}
    image=np.asarray(Image.open(ROOT/'assets/thumbnail.jpg').convert('RGB').resize((518,518)),np.float32)/255
    x=np.ascontiguousarray(image.transpose(2,0,1)[None])
    try:
        reference=None
        if args.reference:
            report['reference'],reference=run(args.reference,x,'CPUExecutionProvider',args.reference_optimization or args.optimization)
            reference.astype('<f4').tofile(args.output/'reference.bin')
        metadata,output=run(args.model,x,provider,args.optimization,args.load_only)
        report.update(metadata)
        if output is not None:
            output.astype('<f4').tofile(args.output/'raw.bin')
        if reference is not None and output is not None:
            comparison={}
            for name,a,b in [('points',reference[:,:3],output[:,:3]),('mask',reference[:,3],output[:,3]),('scale',reference[:,4],output[:,4])]:
                difference=a.astype(np.float64)-b.astype(np.float64)
                comparison[name]={'maxAbs':float(np.abs(difference).max()),'rmse':float(np.sqrt(np.mean(difference**2))),'relativeL2':float(np.linalg.norm(difference.ravel())/max(1e-12,np.linalg.norm(a.ravel())))}
            report['parity']=comparison
            report['referenceModel']=str(args.reference.resolve())
    except Exception as error:
        report.update({'error':str(error),'errorType':type(error).__name__})
        if isinstance(error,UnicodeDecodeError):
            report['localizedErrorBytes']=error.object.decode('cp1254',errors='replace')
        print(json.dumps(report,ensure_ascii=True),flush=True)
        return 1
    finally:
        (args.output/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=True),encoding='utf-8')
    print(json.dumps(report,indent=2),flush=True)
    return 0
if __name__=='__main__':
    sys.exit(main())
