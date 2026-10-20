"""BiRefNet decoder'ındaki çok çıkışlı Split / çok girişli Concat düğümlerini anlamca
BİREBİR aynı, en fazla GROUP girdi/çıktılı ağaçlara böler (hazirla.py çağırır).

Neden: DirectML'de ~%30 hızlı (6,3 sn -> 4,9 sn ölçüldü); tarayıcı WebGPU'su ise orijinali
hiç çalıştıramıyor (shader başına 16 storage buffer sınırı). Çıktı orijinalle bit-bit aynı
(CPU, d93ef… fotoğrafı: logit farkı 0, değişen piksel 0).

Kullanım: python agacla.py <girdi.onnx> <çıktı.onnx>
"""
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper

GROUP = 8
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
inits = {t.name: t for t in g.initializer}
consts = {}
for n in g.node:
    if n.op_type == 'Constant':
        for a in n.attribute:
            if a.name == 'value':
                consts[n.output[0]] = numpy_helper.to_array(a.t)

def const_value(name):
    if name in inits:
        return numpy_helper.to_array(inits[name])
    return consts.get(name)

uid = [0]
def fresh(base):
    uid[0] += 1
    return f'{base}__t{uid[0]}'

def attr(n, key, default=None):
    for a in n.attribute:
        if a.name == key:
            return helper.get_attribute_value(a)
    return default

new_nodes = []
changed = {'Split': 0, 'Concat': 0}
for n in g.node:
    if n.op_type == 'Concat' and len(n.input) > GROUP:
        axis = attr(n, 'axis')
        level = list(n.input)
        while len(level) > GROUP:
            nxt = []
            for i in range(0, len(level), GROUP):
                chunk = level[i:i + GROUP]
                if len(chunk) == 1:
                    nxt.append(chunk[0]); continue
                out = fresh(n.output[0])
                new_nodes.append(helper.make_node('Concat', chunk, [out], axis=axis, name=fresh(n.name)))
                nxt.append(out)
            level = nxt
        new_nodes.append(helper.make_node('Concat', level, list(n.output), axis=axis, name=n.name))
        changed['Concat'] += 1
        continue
    if n.op_type == 'Split' and len(n.output) > GROUP - 1:
        axis = attr(n, 'axis', 0)
        sizes = const_value(n.input[1]) if len(n.input) > 1 and n.input[1] else None
        if sizes is None:
            sizes_attr = attr(n, 'split')
            sizes = np.array(sizes_attr) if sizes_attr is not None else None
        if sizes is None:
            new_nodes.append(n); continue
        sizes = [int(v) for v in sizes]
        outs = list(n.output)
        groups = [list(range(i, min(i + GROUP - 1, len(outs)))) for i in range(0, len(outs), GROUP - 1)]
        if len(groups) > GROUP - 1:
            raise SystemExit(f'too many groups for {n.name}')
        mids = [fresh(n.output[0]) for _ in groups]
        top = helper.make_tensor(fresh('split_sizes'), onnx.TensorProto.INT64, [len(groups)],
                                 [sum(sizes[i] for i in grp) for grp in groups])
        g.initializer.append(top)
        new_nodes.append(helper.make_node('Split', [n.input[0], top.name], mids, axis=axis, name=n.name))
        for mid, grp in zip(mids, groups):
            if len(grp) == 1:
                new_nodes.append(helper.make_node('Identity', [mid], [outs[grp[0]]], name=fresh(n.name)))
                continue
            st = helper.make_tensor(fresh('split_sizes'), onnx.TensorProto.INT64, [len(grp)], [sizes[i] for i in grp])
            g.initializer.append(st)
            new_nodes.append(helper.make_node('Split', [mid, st.name], [outs[i] for i in grp], axis=axis, name=fresh(n.name)))
        changed['Split'] += 1
        continue
    new_nodes.append(n)

del g.node[:]
g.node.extend(new_nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('rewritten', changed)
