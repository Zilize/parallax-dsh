/**
 * Graph layout for the build graph:
 *
 *  - ELK Layered, LEFT→RIGHT, orthogonal edge routing;
 *  - 248×96 cards, 224×32 universe pills, 64px between layers and 24px
 *    between siblings;
 *  - input ports fixed by role (base before subtract), then declaration order;
 *  - edges drawn as rounded orthogonal polylines with quantised corners.
 */

import ELK from 'elkjs/lib/elk.bundled.js'

export interface LayoutNode {
  id: string
  /** Universe pills are smaller than cards. */
  universe?: boolean
}

export interface LayoutEdge {
  id: string
  parent: string
  child: string
  role?: 'base' | 'subtract'
}

export interface LayoutPoint {
  x: number
  y: number
}

export interface LayoutResult {
  positions: Map<string, LayoutPoint>
  /** `${parent}->${child}` → orthogonally routed polyline in flow coordinates. */
  paths: Map<string, LayoutPoint[]>
  width: number
  height: number
}

const CARD = { width: 248, height: 96 }
const UNIVERSE = { width: 224, height: 32 }
const GAP = { x: 64, y: 24 }

const ROLE_RANK: Record<string, number> = { base: 0, subtract: 1 }

/** In-edge index per child per parent: role first, then declaration order. */
export function computeInPorts(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
): { inCount: Map<string, number>, inIndexOf: Map<string, Map<string, number>> } {
  const incoming = new Map<string, LayoutEdge[]>()
  for (const edge of edges) {
    const list = incoming.get(edge.child)
    if (list) list.push(edge)
    else incoming.set(edge.child, [edge])
  }

  const inCount = new Map<string, number>()
  const inIndexOf = new Map<string, Map<string, number>>()
  for (const node of nodes) {
    const sorted = [...(incoming.get(node.id) ?? [])].sort((a, b) =>
      (ROLE_RANK[a.role ?? ''] ?? 0) - (ROLE_RANK[b.role ?? ''] ?? 0)
      || a.parent.localeCompare(b.parent))
    inCount.set(node.id, sorted.length)
    inIndexOf.set(node.id, new Map(sorted.map((edge, index) => [edge.parent, index] as const)))
  }
  return { inCount, inIndexOf }
}

let elkSingleton: Promise<InstanceType<typeof ELK>> | null = null

function getElk(): Promise<InstanceType<typeof ELK>> {
  elkSingleton ??= import('elkjs/lib/elk.bundled.js').then(module => new module.default())
  return elkSingleton
}

/** Run one layout. Deterministic: same input, same output. */
export async function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
): Promise<LayoutResult> {
  const { inCount, inIndexOf } = computeInPorts(nodes, edges)
  const elk = await getElk()

  const dims = (node: LayoutNode): { width: number, height: number } =>
    node.universe === true ? UNIVERSE : CARD

  const elkNodes = nodes.map((node) => {
    const size = dims(node)
    const ports: { id: string, x: number, y: number }[] = []
    const count = Math.max(1, inCount.get(node.id) ?? 0)
    for (let index = 0; index < count; index += 1) {
      ports.push({
        id: `${node.id}-in-${index}`,
        x: 0,
        y: ((index + 1) / (count + 1)) * size.height,
      })
    }
    ports.push({ id: `${node.id}-out`, x: size.width, y: size.height / 2 })
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      ports,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    }
  })

  const elkEdges = edges.map(edge => ({
    id: edge.id,
    sources: [`${edge.parent}-out`],
    targets: [`${edge.child}-in-${inIndexOf.get(edge.child)?.get(edge.parent) ?? 0}`],
  }))

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': `${GAP.y}`,
      'elk.layered.spacing.nodeNodeBetweenLayers': `${GAP.x}`,
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeEdge': '10',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: elkNodes,
    edges: elkEdges,
  }

  type Point = { x: number, y: number }
  interface ElkResult {
    width?: number
    height?: number
    children?: { id: string, x?: number, y?: number }[]
    edges?: { id: string, sections?: { startPoint?: Point, endPoint?: Point, bendPoints?: Point[] }[] }[]
  }

  const result = await elk.layout(graph as never) as unknown as ElkResult
  const positions = new Map<string, LayoutPoint>()
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }

  const paths = new Map<string, LayoutPoint[]>()
  for (const edge of result.edges ?? []) {
    const points: LayoutPoint[] = []
    for (const section of edge.sections ?? []) {
      if (section.startPoint) points.push(section.startPoint)
      for (const bend of section.bendPoints ?? []) points.push(bend)
      if (section.endPoint) points.push(section.endPoint)
    }
    if (points.length > 0) paths.set(edge.id, points)
  }

  return { positions, paths, width: result.width ?? 0, height: result.height ?? 0 }
}

const QUANT = 1000
const quantize = (value: number): number => Math.round(value * QUANT) / QUANT
const direction = (delta: number): number => (Math.abs(delta) < 2 / QUANT ? 0 : Math.sign(delta))

/**
 * Orthogonal polyline with 10px rounded corners. Collinear interior points are
 * dropped first, otherwise their zero-length turns become visible notches.
 */
export function roundedPolylinePath(points: readonly LayoutPoint[]): string {
  if (points.length < 2) return ''
  const pts = points.map(point => ({ x: quantize(point.x), y: quantize(point.y) }))

  const keep: LayoutPoint[] = [pts[0]]
  for (let index = 1; index < pts.length - 1; index += 1) {
    const a = keep[keep.length - 1]
    const b = pts[index]
    const c = pts[index + 1]
    const sameColumn = direction(a.x - b.x) === 0 && direction(b.x - c.x) === 0
    const sameRow = direction(a.y - b.y) === 0 && direction(b.y - c.y) === 0
    if (!sameColumn && !sameRow) keep.push(b)
  }
  keep.push(pts[pts.length - 1])

  if (keep.length < 3) {
    return `M ${keep[0].x} ${keep[0].y} L ${keep[keep.length - 1].x} ${keep[keep.length - 1].y}`
  }

  let d = `M ${keep[0].x} ${keep[0].y}`
  for (let index = 1; index < keep.length - 1; index += 1) {
    const p = keep[index]
    const prev = keep[index - 1]
    const next = keep[index + 1]
    const radius = Math.min(10, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2)
    const inX = direction(prev.x - p.x)
    const inY = direction(prev.y - p.y)
    const outX = direction(next.x - p.x)
    const outY = direction(next.y - p.y)
    d += ` L ${p.x + inX * radius} ${p.y + inY * radius} Q ${p.x} ${p.y} ${p.x + outX * radius} ${p.y + outY * radius}`
  }
  const last = keep[keep.length - 1]
  return `${d} L ${last.x} ${last.y}`
}
