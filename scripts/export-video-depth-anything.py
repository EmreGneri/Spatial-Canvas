"""Export official Apache-2.0 VDA Small with its real temporal attention cache.

CPU only; no network access or dependency installation occurs in this script.
Use an isolated environment with torch2.7.1+cpu, torchvision0.22.1+cpu,
einops, easydict, tqdm, opencv-python-headless, onnx, onnxruntime and
onnxconverter-common. Upstream source/checkpoint must already be present.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

CHECKPOINT_SHA256 = '13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609'
UPSTREAM_COMMIT = '4f5ae23172ba60fd7bc11ef671cca678842c7072'


def verify_checkpoint(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != CHECKPOINT_SHA256:
        raise ValueError('Checkpoint SHA256 differs from the official pinned VDA Small checkpoint')
    return digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--height', type=int, default=154)
    parser.add_argument('--width', type=int, default=266)
    parser.add_argument('--context', type=int, choices=[16, 32], default=32,
                        help='Attention context. 16 is an experimental shorter-cache export; use a separate output directory.')
    args = parser.parse_args()
    if args.height % 14 or args.width % 14 or min(args.height, args.width) < 28:
        parser.error('Width and height must be positive multiples of 14, at least 28')
    digest = verify_checkpoint(args.checkpoint)
    commit = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
    if commit != UPSTREAM_COMMIT:
        raise ValueError(f'Expected upstream commit {UPSTREAM_COMMIT}, got {commit}')

    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from onnxruntime.transformers.float16 import convert_float_to_float16
    from onnxruntime.transformers.onnx_model import OnnxModel
    sys.path.insert(0, str(args.source.resolve()))
    from video_depth_anything.video_depth_stream import VideoDepthAnything

    torch.manual_seed(7)
    torch.set_num_threads(4)
    model = VideoDepthAnything(encoder='vits', features=64, out_channels=[48, 96, 192, 384]).eval()
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True), strict=True)
    height, width = args.height, args.width

    class Encoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.backbone = model.pretrained

        def forward(self, pixels):
            return tuple(x[0] for x in self.backbone.get_intermediate_layers(pixels, [2, 5, 8, 11], return_class_token=True))

    class Head(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.head = model.head

        def forward(self, *inputs):
            features = tuple((x, None) for x in inputs[:4])
            depth, cache = self.head(features, height // 14, width // 14, 1,
                                     cached_hidden_state_list=list(inputs[4:]) if len(inputs) > 4 else None)
            depth = torch.nn.functional.relu(torch.nn.functional.interpolate(depth, size=(height, width), mode='bilinear', align_corners=True))
            return (depth, *cache)

    encoder, head = Encoder().eval(), Head().eval()
    sample = torch.randn(1, 3, height, width)
    next_sample = torch.randn(1, 3, height, width)
    with torch.inference_mode():
        features = encoder(sample)
        initial = head(*features)
        history = tuple(c.repeat(1, args.context - 1, 1) for c in initial[1:])
        next_features = encoder(next_sample)
        streamed = head(*next_features, *history)
        # Wrapper must preserve the official forward_depth tensor and cache semantics.
        official = model.forward_depth(tuple((x, None) for x in next_features), (1, 1, 3, height, width), history)
        torch.testing.assert_close(streamed[0].reshape(1, 1, height, width), official[0])
        for actual, expected in zip(streamed[1:], official[1], strict=True):
            torch.testing.assert_close(actual, expected)

    destination = args.output
    manifest_path = destination / 'export-manifest.json'
    if manifest_path.exists() and json.loads(manifest_path.read_text(encoding='utf-8')).get('window') != args.context:
        raise ValueError('Use a separate output directory for each attention context; existing assets were not changed')
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = tempfile.TemporaryDirectory(prefix='vda-export-', dir=destination.parent)
    args.output = Path(staging.name)
    for name, tensor in [('pixels0', sample), ('pixels1', next_sample), ('depth0', initial[0]), ('depth1', streamed[0])]:
        tensor.detach().numpy().astype('<f4').tofile(args.output / f'parity-{name}.bin')
    feature_names = [f'feat{i}' for i in range(1, 5)]
    cache_names = [f'cache{i}' for i in range(8)]
    report = {'checkpointSha256': digest, 'upstreamCommit': commit, 'torch': torch.__version__,
              'resolution': [height, width], 'window': args.context, 'cacheFrames': args.context - 1,
              'experimentalContext': args.context != 32, 'license': 'Apache-2.0', 'files': {}}

    def export(name, wrapper, inputs, names, outputs, expected):
        print(f'Exporting {name}', flush=True)
        fp32_path = args.output / f'{name}_fp32.onnx'
        with torch.inference_mode():
            torch.onnx.export(wrapper, inputs, fp32_path, input_names=names, output_names=outputs,
                              opset_version=17, dynamo=False, do_constant_folding=True)
        graph = onnx.load(fp32_path)
        onnx.checker.check_model(graph, full_check=True)
        feeds = {n: x.detach().numpy() for n, x in zip(names, inputs, strict=True)}
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        # Fixed-resolution positional embedding depends only on constants. Fold
        # its exact fp32 bicubic interpolation before fp16 conversion: ORT WebGPU
        # currently cannot compile this constant ResizeBiCubic shader.
        half_source = fp32_path
        if name == 'encoder':
            half_source = args.output / 'encoder_fp32_folded.onnx'
            fold_options = ort.SessionOptions()
            fold_options.intra_op_num_threads = 4
            fold_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
            fold_options.optimized_model_filepath = str(half_source)
            fold_session = ort.InferenceSession(str(fp32_path), fold_options, providers=['CPUExecutionProvider'])
            del fold_session
            assert not any(n.op_type == 'Resize' for n in onnx.load(half_source).graph.node)
        checks = {}
        for precision in ['fp32', 'fp16']:
            path = fp32_path
            if precision == 'fp16':
                path = args.output / f'{name}_fp16.onnx'
                half = convert_float_to_float16(onnx.load(half_source), keep_io_types=True)
                OnnxModel(half).topological_sort()
                onnx.checker.check_model(half)
                onnx.save(half, path)
            session = ort.InferenceSession(str(path), options, providers=['CPUExecutionProvider'])
            actual = session.run(None, feeds)
            errors = []
            for actual_tensor, reference in zip(actual, expected, strict=True):
                reference = reference.detach().numpy()
                error = float(np.max(np.abs(actual_tensor - reference)))
                errors.append(error)
                np.testing.assert_allclose(actual_tensor, reference, rtol=0.04 if precision == 'fp16' else 0.002,
                                           atol=0.06 if precision == 'fp16' else 0.002)
            checks[precision] = {'maxAbsoluteErrors': errors}
            report['files'][path.name] = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                        'inputs': [{'name': x.name, 'shape': x.shape, 'type': x.type} for x in session.get_inputs()],
                                        'outputs': [{'name': x.name, 'shape': x.shape, 'type': x.type} for x in session.get_outputs()]}
            del session
        report[name] = checks
        print(f'{name}: parity passed', flush=True)

    export('encoder', encoder, (sample,), ['pixels'], feature_names, features)
    export('bootstrap', head, tuple(features), feature_names, ['depth', *cache_names], initial)
    export('stream', head, (*next_features, *history), [*feature_names, *cache_names], ['depth', *[f'nextCache{i}' for i in range(8)]], streamed)
    (args.output / 'export-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    # Publish only after every graph and fp16 output has passed parity.
    destination.mkdir(parents=True, exist_ok=True)
    for path in args.output.iterdir():
        os.replace(path, destination / path.name)
    staging.cleanup()
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
