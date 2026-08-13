import type { ParamValues } from './params';

/**
 * NODE GRAPH VERİ MODELİ (Gün 4 — ARCHITECTURE.md ile birebir).
 *
 * Sahne boru hattının tek doğruluk kaynağı bu graf'tır: preset = graf +
 * parametreler (parametreler düğümlerin üstünde durur). UI bugün yok;
 * React Flow kurulmaz, veri modeli ve topolojik sıra yeterli.
 *
 * Düğüm tipleri (6):
 *   media      — görsel kaynağı (synthetic | upload | camera; medya gömülmez)
 *   depth      — depth boru hattı (model / luminance)
 *   particles  — GPGPU simülasyonu (parametreleri SIM_PARAMS)
 *   feedback   — POST-PASS ZİNCİRİ (Gün 7 + Gün A): feedback birikimi +
 *                chromatic aberration + bloom + grain/vignette (ve her
 *                parametresi olmayan FXAA) — zincir bu düğümden açılır/kapanır,
 *                parametreleri düğümde düz sözlükle yaşar
 *   renderer   — render modu (mode: 'points' | 'ascii' | 'neon' | 'solid' + material parametreleri)
 *   output     — ekran çıktısı (Gün A: global look — ACES exposure + sis;
 *                LOOK_PARAMS kollarını taşır)
 *
 * Kenar = veri akışı. Bir düğümün "aktif" olması media'dan erişilebilir
 * olmasına bağlı: feedback düğümünün giriş kenarı kesilirse post-pass zinciri
 * gerçekten kapanır (engine setGraph composer'ı buna göre kurar).
 */

export type NodeType = 'media' | 'depth' | 'particles' | 'feedback' | 'renderer' | 'output';

export const NODE_TYPES: readonly NodeType[] = [
  'media',
  'depth',
  'particles',
  'feedback',
  'renderer',
  'output',
];

export interface GraphNode {
  id: string;
  type: NodeType;
  /** Düğümün parametreleri — preset'in parametre kısmı da buradadır. */
  params: ParamValues;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Varsayılan graf — bugünkü sabit zincirin birebir karşılığı:
 * media → depth → particles → renderer → feedback → output.
 */
export function createDefaultGraph(): Graph {
  const ids = ['media', 'depth', 'particles', 'renderer', 'feedback', 'output'];
  return {
    nodes: ids.map((id) => ({ id, type: id as NodeType, params: {} })),
    edges: [
      { from: 'media', to: 'depth' },
      { from: 'depth', to: 'particles' },
      { from: 'particles', to: 'renderer' },
      { from: 'renderer', to: 'feedback' },
      { from: 'feedback', to: 'output' },
    ],
  };
}

/** Graf tutarlı mı? Kural dışılıkları mesaj listesi olarak döner, asla patlamaz. */
export function validateGraph(graph: Graph): string[] {
  const problems: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const node of graph.nodes) {
    if (!NODE_TYPES.includes(node.type)) {
      problems.push(`bilinmeyen düğüm tipi '${node.type}' (${node.id})`);
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) problems.push(`kenar ${edge.from}→${edge.to}: kaynak yok`);
    if (!ids.has(edge.to)) problems.push(`kenar ${edge.from}→${edge.to}: hedef yok`);
  }
  return problems;
}

/**
 * Değerlendirme sırası (Kahn). Kenarlar veri akışı yönündedir; sıra bağımlı
 * düğümü bağımlılıklarından sonraya koyar. Çevrimler (feedback render
 * döngüsü) kural dışı değildir: çözülmeyenler sıraya en son eklenir.
 */
export function topologicalOrder(graph: Graph): string[] {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)!.push(edge.to);
  }
  const ready: string[] = [];
  for (const [id, deg] of indegree) if (deg === 0) ready.push(id);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.pop()!;
    order.push(id);
    for (const next of outgoing.get(id)!) {
      const deg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, deg);
      if (deg === 0) ready.push(next);
    }
  }
  // Çevrimde kalanlar: feedback gibi render döngüleri — sıra sonuna eklenir.
  for (const [id, deg] of indegree) if (deg > 0) order.push(id);
  return order;
}

/**
 * Aktif düğümler: media tipindeki düğümlerden kenarlar boyunca erişilebilenler.
 * Girişi kesilmiş (ya da hiç kurulmamış) düğüm devre dışıdır — engine
 * composer'ı ve parametre uygulamasını buna göre yapar. Graf media içermiyorsa
 * boş küme döner; çağıran (engine) bunu uyarıya çevirir.
 */
export function activeNodes(graph: Graph): Set<string> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of graph.edges) {
    if (ids.has(edge.from) && ids.has(edge.to)) adjacency.get(edge.from)!.push(edge.to);
  }
  const active = new Set<string>();
  const queue: string[] = graph.nodes.filter((n) => n.type === 'media').map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (active.has(id)) continue;
    active.add(id);
    queue.push(...adjacency.get(id)!);
  }
  return active;
}
