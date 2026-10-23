"""Specialize official MoGe ONNX without PyTorch; optionally convert to mixed FP16.

python scripts/prepare-moge-sidecar.py --source <onnx> --output <new.onnx> [--fp16]
Specialization preserves FP32 arithmetic. FP16 is an approximate conversion and
requires inference parity measurements before deployment. This never overwrites input.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def prepare(source, output, fp16=False):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.exists():
        raise ValueError('Choose a new output path; source and existing outputs are preserved')
    print('Loading source ONNX', flush=True)
    model = onnx.load(str(source))
    image = next(value for value in model.graph.input if value.name == 'image')
    for dimension, value in zip(image.type.tensor_type.shape.dim, [1, 3, 518, 518]):
        dimension.ClearField('dim_param')
        dimension.dim_value = value
    tokens = next(value for value in model.graph.input if value.name == 'num_tokens')
    model.graph.input.remove(tokens)
    model.graph.initializer.append(numpy_helper.from_array(np.array(1800, np.int64), name='num_tokens'))
    # Prune unused normals with a backwards dependency walk; retain all nodes
    # and initializers required by points, mask and metric scale.
    output_names = {value.name for value in model.graph.output}
    scale_name = 'metric_scale' if 'metric_scale' in output_names else 'scale'
    wanted = {'points', 'mask', scale_name}
    if not wanted.issubset({value.name for value in model.graph.output}):
        raise ValueError('Unexpected official output contract; inspect model before transforming')
    for value in list(model.graph.output):
        if value.name not in wanted:
            model.graph.output.remove(value)
    needed = set(wanted)
    kept = []
    for node in reversed(model.graph.node):
        if needed.intersection(node.output):
            kept.append(node)
            needed.update(node.input)
    del model.graph.node[:]
    model.graph.node.extend(reversed(kept))
    for initializer in list(model.graph.initializer):
        if initializer.name not in needed:
            model.graph.initializer.remove(initializer)
    # Shape inference is CPU-only and enables consistent cast insertion for
    # the maintained ORT converter, rather than replacing dtype enum values.
    if fp16:
        from onnxruntime.transformers.float16 import convert_float_to_float16
        from onnxruntime.transformers.onnx_model import OnnxModel
        print('Converting with ORT mixed-FP16 converter, preserving FP32 I/O', flush=True)
        model = convert_float_to_float16(model, keep_io_types=True)
        OnnxModel(model).topological_sort(is_deterministic=True)
    print('Checking and saving transformed ONNX', flush=True)
    onnx.checker.check_model(model)
    output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, str(output))
    contract = {'inputs': [{'name': value.name, 'type': helper.printable_type(value.type)} for value in model.graph.input],
                'outputs': [{'name': value.name, 'type': helper.printable_type(value.type)} for value in model.graph.output]}
    del model
    gc.collect()
    import onnxruntime as ort
    manifest = {'source': str(source), 'sourceBytes': source.stat().st_size, 'sourceSha256': sha256(source),
                'output': str(output), 'outputBytes': output.stat().st_size, 'outputSha256': sha256(output),
                'transform': {'image': [1, 3, 518, 518], 'fixedNumTokens': 1800, 'pruneNormalOutput': True,
                              'fp16': fp16, 'fp32IO': True, 'constantFolding': False},
                'versions': {'onnx': onnx.__version__, 'onnxruntime': ort.__version__, 'numpy': np.__version__},
                'contract': contract, 'parity': 'Not measured by preparation; run benchmark/reference comparison'}
    output.with_suffix(output.suffix + '.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest, indent=2), flush=True)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fp16', action='store_true')
    args = parser.parse_args()
    prepare(args.source, args.output, args.fp16)
