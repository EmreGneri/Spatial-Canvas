"""Export the genuine official T32 temporal head at 154x266; verify PyTorch/ORT parity.

Reuses encoder_fp16.onnx from the pinned streaming export (same DINOv2 backbone).
No source, checkpoint or dependency downloads occur here.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REVISION = '4f5ae23172ba60fd7bc11ef671cca678842c7072'
CHECKPOINT = '13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.checkpoint.read_bytes()).hexdigest() != CHECKPOINT:
        raise ValueError('Official checkpoint hash mismatch')
    revision = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != REVISION:
        raise ValueError('Official source revision mismatch')
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    from onnxruntime.transformers.float16 import convert_float_to_float16
    from onnxruntime.transformers.onnx_model import OnnxModel
    sys.path.insert(0, str(args.source.resolve()))
    from video_depth_anything.video_depth import VideoDepthAnything
    torch.manual_seed(7)
    torch.set_num_threads(4)
    model = VideoDepthAnything(encoder='vits', features=64, out_channels=[48, 96, 192, 384]).eval()
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True), strict=True)

    class Head(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.head = model.head

        def forward(self, *features):
            depth = self.head(tuple((x, None) for x in features), 11, 19, 32, micro_batch_size=32)[0]
            return torch.nn.functional.relu(torch.nn.functional.interpolate(depth, size=(154, 266), mode='bilinear', align_corners=True)).reshape(32, 154, 266)

    wrapper = Head().eval()
    # Distinct features per frame exercise temporal attention, rather than 32 identical inputs.
    features = tuple(torch.randn(32, 209, 384) for _ in range(4))
    names = [f'feat{i}' for i in range(1, 5)]
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / 'offline32_fp32.onnx'
    with torch.inference_mode():
        expected = wrapper(*features).numpy()
        official = model.head(tuple((x, None) for x in features), 11, 19, 32)[0]
        official = torch.nn.functional.relu(torch.nn.functional.interpolate(official, size=(154, 266), mode='bilinear', align_corners=True)).reshape(32, 154, 266)
        np.testing.assert_allclose(expected, official.numpy(), rtol=0.002, atol=0.002)
        torch.onnx.export(wrapper, features, path, input_names=names, output_names=['depth'], opset_version=17, dynamo=False)
    report = {'upstreamCommit': revision, 'checkpointSha256': CHECKPOINT, 'window': 32,
              'resolution': [154, 266], 'license': 'Apache-2.0', 'files': {}}
    for precision in ['fp32', 'fp16']:
        target = path
        if precision == 'fp16':
            target = args.output / 'offline32_fp16.onnx'
            graph = convert_float_to_float16(onnx.load(path), keep_io_types=True)
            OnnxModel(graph).topological_sort()
            onnx.checker.check_model(graph)
            onnx.save(graph, target)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        session = ort.InferenceSession(str(target), options, providers=['CPUExecutionProvider'])
        actual = session.run(None, {name: value.numpy() for name, value in zip(names, features)})[0]
        np.testing.assert_allclose(actual, expected, rtol=0.04 if precision == 'fp16' else 0.002, atol=0.06 if precision == 'fp16' else 0.002)
        report['files'][target.name] = {'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                                      'bytes': target.stat().st_size, 'maxAbsoluteError': float(np.max(np.abs(actual - expected)))}
        print(f'{target.name}: true T32 parity passed', flush=True)
    (args.output / 'offline-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
