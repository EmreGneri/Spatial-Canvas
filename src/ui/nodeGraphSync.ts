import type { Node } from '@xyflow/react';
import type { Graph, GraphNode, NodeType } from '../engine/graph';
import { toPreset, type PresetSource } from '../engine/preset';

/**
 * Pure graph <-> editor rules of NodeGraphEditor, kept free of React so
 * scripts/verify-graph-params.mjs can run them in Node.
 */

export interface SpatialNodeData {
  nodeType: NodeType;
  paramCount: number;
  /** React Flow expects node.data to be a Record<string, unknown>. */
  [key: string]: unknown;
}

export type SpatialNodeType = Node<SpatialNodeData>;

export function toRfNodes(graph: Graph): SpatialNodeType[] {
  return graph.nodes.map((n, i) => ({
    id: n.id,
    type: 'spatial',
    position: { x: 24 + i * 150, y: 130 },
    data: { nodeType: n.type, paramCount: Object.keys(n.params).length },
    // The node set is fixed. Without this, xyflow's delete key also removes
    // every edge of a selected node, even though the node removal is ignored.
    deletable: false,
  }));
}

/**
 * The engine graph with node params re-read from the live uniforms (the same
 * refresh toPreset does). Uniforms are the single source of truth:
 * ControlPanel, reset and render presets write them directly, so stored node
 * params go stale, and handing those to setGraph on the next edge change
 * would undo the panel. The renderer node gets the active mode's values only.
 */
export function liveGraph(source: PresetSource): Graph {
  return toPreset(source, '').graph;
}

/**
 * One editor edit on a live graph. Switching mode drops the other renderer
 * params: they are the old material's values and setGraph would apply them to
 * the new one (modes share uniform names). The new material keeps its own.
 */
export function setParam(
  graph: Graph,
  nodeId: string,
  key: string,
  value: number | string,
): GraphNode | undefined {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  node.params = key === 'mode' ? { mode: value } : { ...node.params, [key]: value };
  return node;
}
