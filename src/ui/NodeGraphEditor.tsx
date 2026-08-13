import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Engine } from '../engine';
import {
  createDefaultGraph,
  type Graph,
  type GraphNode,
  type NodeType,
} from '../engine/graph';
import type { ParamDef } from '../engine/params';
import { SIM_PARAMS } from '../engine/simulation';
import { GRAIN_PARAMS } from '../shaders/grainPass';
import { FEEDBACK_PARAMS } from '../shaders/feedbackPass';
import { CHROMATIC_PARAMS } from '../shaders/chromaticPass';
import { BLOOM_PARAMS } from '../shaders/bloomPass';
import { LOOK_PARAMS } from '../shaders/look';
import { POINTS_PARAMS } from '../shaders/pointCloudMaterial';
import { ASCII_PARAMS } from '../shaders/asciiMaterial';
import { SOLID_PARAMS } from '../shaders/solidMaterial';

/**
 * NODE GRAPH EDITÖRÜ (Gün 5 — veri katmanının UI'ı, Emre).
 *
 * Grafın görsel düzenleyicisi. Tek doğruluk kaynağı KORUNUR: her değişiklik
 * (kenar bağla/kopar, parametre) engine.setGraph'a gider; editör ayrı bir
 * durum ağacı tutmaz. Düğüm konumları yalnızca UI'dır, graf şemasında yoktur.
 *
 * Kanıt akışı: feedback düğümüne giden kabloyu çek → post-pass zinciri
 * (feedback birikimi + chromatic + grain/vignette) composer'dan çıkar,
 * sahne gerçekten değişir. Kabloyu geri tak → hepsi geri gelir.
 *
 * Bilinen sınırlar (v1): düğüm SİLİNEMEZ (yalnızca kenar); ascii karakter
 * seti (setCharSet API'si) editörde düzenlenmez — ControlPanel'de düzenlenir.
 * GÜN 8: mod takası çift yönlü senkron — editörün renderer düğümünden mod
 * değiştirmek onRenderModeChange ile dışarı bildirilir; dışarıdaki takaslar
 * (ModeSelector/ControlPanel) Engine.selectRenderMode ile graf params'ına
 * yazdığı için editör tazelenince doğru modu görür.
 */

const NODE_META: Record<NodeType, { label: string; color: string }> = {
  media: { label: 'Media', color: '#3b82f6' },
  depth: { label: 'Depth', color: '#8b5cf6' },
  particles: { label: 'Particles', color: '#f59e0b' },
  feedback: { label: 'Feedback', color: '#ef4444' },
  renderer: { label: 'Renderer', color: '#10b981' },
  output: { label: 'Output', color: '#64748b' },
};

/** Düğüm tipleri hangi parametre tanımını taşır — editörün tek eşlemesi. */
function nodeDefs(type: NodeType, mode?: unknown): ParamDef[] {
  if (type === 'particles') return SIM_PARAMS;
  if (type === 'feedback') {
    // Post-pass zinciri (Gün 7 + Gün A): feedback + chromatic + bloom + grain
    // hepsi bu düğümde.
    return [...FEEDBACK_PARAMS, ...CHROMATIC_PARAMS, ...BLOOM_PARAMS, ...GRAIN_PARAMS];
  }
  if (type === 'renderer') {
    if (String(mode) === 'ascii') return ASCII_PARAMS;
    if (String(mode) === 'solid') return SOLID_PARAMS;
    return POINTS_PARAMS;
  }
  if (type === 'output') return LOOK_PARAMS;
  return [];
}

interface SpatialNodeData {
  nodeType: NodeType;
  paramCount: number;
  /** React Flow, node.data'yı Record<string, unknown> bekler. */
  [key: string]: unknown;
}

type SpatialNodeType = Node<SpatialNodeData>;

function SpatialNode({ data, selected }: NodeProps<SpatialNodeType>) {
  const meta = NODE_META[data.nodeType];
  return (
    <div
      style={{
        background: '#14141c',
        border: `1px solid ${selected ? meta.color : '#2a2a34'}`,
        borderRadius: 6,
        padding: '6px 10px',
        color: '#c8c8d4',
        fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
        fontSize: 12,
        minWidth: 96,
        textAlign: 'center',
        boxShadow: selected ? `0 0 0 1px ${meta.color}` : 'none',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: meta.color }} />
      <div style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</div>
      <div style={{ color: '#667', fontSize: 10, marginTop: 2 }}>
        {data.paramCount} parametre
      </div>
      <Handle type="source" position={Position.Right} style={{ background: meta.color }} />
    </div>
  );
}

/** Modül düzeyi sabit — React Flow her render'da nodeTypes nesnesi istemez. */
const nodeTypes = { spatial: SpatialNode };

function toRfNodes(graph: Graph): SpatialNodeType[] {
  return graph.nodes.map((n, i) => ({
    id: n.id,
    type: 'spatial',
    position: { x: 24 + i * 150, y: 130 },
    data: { nodeType: n.type, paramCount: Object.keys(n.params).length },
  }));
}

function toRfEdges(graph: Graph): Edge[] {
  return graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

/** Editörün sunduğu modlar — ModeSelector ile aynı küme, bağımlılık yok. */
export type EditorRenderMode = 'points' | 'ascii' | 'neon' | 'solid';

export function NodeGraphEditor({
  engine,
  graphTick,
  onRenderModeChange,
}: {
  engine: Engine;
  graphTick: number;
  /** Editörden mod değişti — App UI state'ini senkronlamak için. */
  onRenderModeChange?: (mode: EditorRenderMode) => void;
}) {
  // useNodesState lazy init almaz; engine.currentGraph ilk render'da sabittir.
  const initialNodes = useMemo(() => toRfNodes(engine.currentGraph), [engine]);
  const initialEdges = useMemo(() => toRfEdges(engine.currentGraph), [engine]);
  const [nodes, setNodes, onNodesChange] = useNodesState<SpatialNodeType>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Editör durumundan graf kurar ve engine'e verir — tek doğruluk kaynağı. */
  const syncToEngine = useCallback(
    (ns: SpatialNodeType[], es: Edge[]) => {
      const graph: Graph = {
        nodes: ns.map((n) => {
          const source = engine.currentGraph.nodes.find((gn) => gn.id === n.id);
          return {
            id: n.id,
            type: source?.type ?? 'output',
            params: source?.params ?? {},
          };
        }),
        edges: es.map((e) => ({ from: e.source, to: e.target })),
      };
      engine.setGraph(graph);
    },
    [engine],
  );

  // Graf motor dışından kurulduysa (preset yükleme, Gün 8: mod takası) UI'ı
  // tazele. Düğüm id'leri her grafta sabittir (6 sabit düğüm), seçim paneli
  // değeri her render'da engine.currentGraph'tan okur — seçimi sıfırlamak
  // kullanıcıyı ezerdi (mod değişimi sonrası panel kapanırdı), bu yüzden
  // yalnızca düğüm/kenar UI'ı güncellenir.
  useEffect(() => {
    setNodes(toRfNodes(engine.currentGraph));
    setEdges(toRfEdges(engine.currentGraph));
  }, [graphTick, engine, setNodes, setEdges]);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      if (edges.some((e) => e.source === conn.source && e.target === conn.target)) return;
      const next = addEdge(
        { ...conn, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
        edges,
      );
      setEdges(next);
      syncToEngine(nodes, next);
    },
    [edges, nodes, syncToEngine],
  );

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      const source = conn.source;
      const target = conn.target;
      return (
        !!source &&
        !!target &&
        source !== target &&
        !edges.some((e) => e.source === source && e.target === target)
      );
    },
    [edges],
  );

  // Düğüm silme v1'de desteklenmiyor (graf şemasında düğüm seti sabittir) —
  // klavyeyle düğüm silme isteklerini yut; kenar silme ise engine'e işler.
  const onNodesChanges = useCallback((changes: NodeChange<SpatialNodeType>[]) => {
    const filtered = changes.filter((c) => c.type !== 'remove');
    if (filtered.length) setNodes((nds) => applyNodeChanges(filtered, nds));
  }, [setNodes]);

  const onEdgesChanges = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.some((c) => c.type === 'remove');
      const next = applyEdgeChanges(changes, edges);
      setEdges(next);
      if (removed) syncToEngine(nodes, next);
    },
    [edges, nodes, syncToEngine],
  );

  /** Seçili düğümün parametresini değiştirir: graf params'ı + engine, birlikte. */
  function setNodeParam(nodeId: string, key: string, value: number | string) {
    const graph = engine.currentGraph;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.params = { ...node.params, [key]: value };
    engine.setGraph(graph);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, paramCount: Object.keys(node.params).length } } : n,
      ),
    );
  }

  function resetGraph() {
    engine.setGraph(createDefaultGraph());
    setNodes(toRfNodes(engine.currentGraph));
    setEdges(toRfEdges(engine.currentGraph));
    setSelectedId(null);
  }

  const selected = engine.currentGraph.nodes.find((n) => n.id === selectedId);

  return (
    <div style={{ display: 'grid', gap: 8, width: 640 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ color: '#667', fontSize: 12 }}>graf:</span>
        <button
          type="button"
          onClick={resetGraph}
          style={{ fontSize: 12, padding: '3px 10px', background: '#1a1a22', color: '#c8c8d4', border: '1px solid #26262e', borderRadius: 3, cursor: 'pointer' }}
        >
          varsayılana sıfırla
        </button>
        <span style={{ color: '#667', fontSize: 12 }}>
          kabloyu çek → pass gerçekten kapanır · kenar seç + Backspace/Delete ile kopar
        </span>
      </div>
      <div style={{ width: 640, height: 300, border: '1px solid #1d1d26', background: '#0d0d13', borderRadius: 6 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChanges}
          onEdgesChange={onEdgesChanges}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.4}
          maxZoom={1.6}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background gap={18} color="#1a1a22" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <ParamPanel
        engine={engine}
        node={selected}
        defs={selected ? nodeDefs(selected.type, selected.params.mode) : []}
        onParam={setNodeParam}
        onRenderModeChange={onRenderModeChange}
      />
    </div>
  );
}

/** Seçili düğümün parametre paneli — tanım listesinden üretilir, isim bilmez. */
function ParamPanel({
  engine,
  node,
  defs,
  onParam,
  onRenderModeChange,
}: {
  engine: Engine;
  node: GraphNode | undefined;
  defs: ParamDef[];
  onParam: (nodeId: string, key: string, value: number | string) => void;
  onRenderModeChange?: (mode: EditorRenderMode) => void;
}) {
  const row: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    fontSize: 12,
  };

  if (!node) {
    return <div style={{ color: '#556', fontSize: 12 }}>parametreler — bir düğüm seç</div>;
  }
  const meta = NODE_META[node.type];

  return (
    <div style={{ display: 'grid', gap: 6, color: '#889', border: `1px solid ${meta.color}33`, background: '#101018', borderRadius: 6, padding: 8 }}>
      <div style={{ ...row, color: meta.color, fontWeight: 700 }}>
        {meta.label} <span style={{ color: '#556', fontWeight: 400 }}>· {node.id}</span>
        <span style={{ marginLeft: 'auto', color: '#556', fontWeight: 400 }}>
          {node.type === 'particles' || node.type === 'feedback' ? (node.params ? Object.keys(node.params).length : 0) + ' parametre' : ''}
        </span>
      </div>

      {node.type === 'renderer' && (
        <div style={row}>
          <span>mod:</span>
          {(['points', 'ascii', 'neon', 'solid'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onParam(node.id, 'mode', m);
                onRenderModeChange?.(m);
              }}
              style={{
                fontWeight: String(node.params.mode) === m ? 700 : 400,
                fontSize: 12,
                padding: '2px 10px',
                background: String(node.params.mode) === m ? '#1f2b26' : '#14141c',
                color: String(node.params.mode) === m ? '#10b981' : '#889',
                border: '1px solid #26262e',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {node.type === 'media' && (
        <div style={row}>
          <span>kaynak:</span>
          <span style={{ color: '#8ab' }}>{engine.mediaType}</span>
          <span style={{ color: '#556' }}>medya gömülmez — preset'e yalnızca tür girer</span>
        </div>
      )}

      {defs.map((def) => {
        const value = node.params[def.key];
        if (def.kind === 'color') {
          const hex = typeof value === 'string' ? value : '#ffffff';
          return (
            <label key={def.key} style={row}>
              <span style={{ width: 110 }}>{def.label}</span>
              <input
                type="color"
                value={hex}
                onChange={(e) => onParam(node.id, def.key, e.target.value)}
                style={{ width: 34, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              />
              <span style={{ color: '#8ab', fontVariantNumeric: 'tabular-nums' }}>{hex}</span>
            </label>
          );
        }
        const current = typeof value === 'number' ? value : def.default;
        const min = def.min ?? 0;
        const max = def.max ?? 1;
        const step = max - min <= 2 ? (max - min) / 200 : (max - min) / 100;
        return (
          <label key={def.key} style={row}>
            <span style={{ width: 110 }}>{def.label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={current}
              onChange={(e) => onParam(node.id, def.key, e.target.valueAsNumber)}
              style={{ width: 180 }}
            />
            <span style={{ color: '#8ab', fontVariantNumeric: 'tabular-nums' }}>{current.toFixed(3)}</span>
          </label>
        );
      })}
    </div>
  );
}
