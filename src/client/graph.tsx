/**
 * The build graph: ELK-layered layout, orthogonal rounded edges and 248×96
 * node cards. A rule filter with no parent reads the corpus directly; it gets
 * a virtual "universe" pill showing its scope.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react'
import {
  Bot,
  Info,
  Filter,
  ListOrdered,
  Loader2,
  SquaresSubtract,
  SquaresUnite,
  Tags,
  TriangleAlert,
} from 'lucide-react'
import { isJudging, type NodeView, type Op } from './sets-api.ts'
import { formatCount } from './http.ts'
import { computeInPorts, layoutGraph, roundedPolylinePath, type LayoutEdge, type LayoutNode, type LayoutResult } from './layout.ts'
import { describeNode, describeUniverse } from './describe.ts'
import { translator, type LocaleKey, type Translate } from './i18n.ts'

const ICONS: Record<Op, typeof Filter> = {
  rule_filter: Filter,
  seed: ListOrdered,
  ai_classifier: Tags,
  classification_output: Tags,
  ai_filter: Bot,
  union: SquaresUnite,
  subtract: SquaresSubtract,
}

export { ICONS as OP_ICONS }

const UNIVERSE_PREFIX = 'universe:'

/** Card second line: the operator, refined by the first definition line. */
function metaLine(node: NodeView, tr: Translate): string {
  const op = tr(`op.${node.op}` as LocaleKey)
  const detail = node.op === 'rule_filter' || node.op === 'seed' ? describeNode(node, [], tr)[0] : undefined
  return detail === undefined ? op : `${op} · ${detail}`
}

export function nodeState(node: NodeView): 'running' | 'failed' | undefined {
  if (node.error !== undefined) return 'failed'
  if (node.op !== 'ai_filter' && node.op !== 'ai_classifier') return undefined
  if (isJudging(node)) return 'running'
  if (node.job?.status === 'failed') return 'failed'
  return undefined
}

interface CardData extends Record<string, unknown> {
  node?: NodeView
  universe?: string
  onInspect?: (code: string) => void
  selected: boolean
  inCount: number
  outCount: number
  tr: Translate
}

function Ports({ inCount, outCount }: { inCount: number, outCount: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: inCount }, (_, index) => (
        <Handle
          key={`in-${index}`}
          id={`in-${index}`}
          type="target"
          position={Position.Left}
          isConnectable={false}
          style={{ top: `${((index + 1) / (inCount + 1)) * 100}%` }}
        />
      ))}
      {outCount > 0 ? (
        <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      ) : null}
    </>
  )
}

const Card = memo(function Card({ data }: NodeProps<Node<CardData, 'pgCard'>>) {
  const { selected, inCount, outCount, tr } = data
  const node = data.node as NodeView
  const Icon = ICONS[node.op]
  const state = nodeState(node)
  const judging = node.op === 'ai_filter' || node.op === 'ai_classifier' || node.op === 'classification_output'

  return (
    <div className={['pg-card', selected ? 'is-selected' : '', state === 'failed' ? 'is-failed' : ''].filter(Boolean).join(' ')}>
      <div className="pg-card-row pg-card-row--identity">
        <span className="pg-card-chip"><Icon size={14} aria-hidden /></span>
        <span className="pg-card-name" title={node.name}>{node.name}</span>
        {data.onInspect === undefined ? null : (
          <button
            type="button"
            className="pg-card-info"
            aria-label={tr('graph.inspect')}
            onClick={(event) => { event.stopPropagation(); data.onInspect?.(node.code) }}
          >
            <Info size={13} aria-hidden />
          </button>
        )}
        {state === 'running' ? (
          <span className="pg-card-state" aria-label={tr('graph.running')}><Loader2 size={14} className="pg-spin" aria-hidden /></span>
        ) : state === 'failed' ? (
          <span className="pg-card-state is-failed" aria-label={tr('graph.failedJob')} title={node.error ?? node.job?.lastError ?? ''}><TriangleAlert size={14} aria-hidden /></span>
        ) : null}
      </div>
      <div className="pg-card-row pg-card-row--meta">
        <span className="pg-card-meta" title={metaLine(node, tr)}>{metaLine(node, tr)}</span>
      </div>
      <div className="pg-card-row pg-card-row--amount">
        <span className="pg-pill">{tr('graph.members', { count: formatCount(node.count) })}</span>
        {judging ? <span className="pg-backend">Jev</span> : null}
        {node.undecided === undefined || node.undecided === 0 ? null : (
          <span className="pg-pill pg-pill--undecided">{tr('graph.undecided', { count: formatCount(node.undecided) })}</span>
        )}
      </div>
      <Ports inCount={inCount} outCount={outCount} />
    </div>
  )
})

const UniverseCard = memo(function UniverseCard({ data }: NodeProps<Node<CardData, 'pgUniverse'>>) {
  return (
    <div className="pg-universe" title={data.universe}>
      <span>arXiv</span>
      <span className="pg-universe-detail">{data.universe}</span>
      <Ports inCount={0} outCount={data.outCount} />
    </div>
  )
})

function PgEdge({ data }: EdgeProps<Edge<{ d: string, dashed: boolean }>>): JSX.Element {
  return (
    <path
      className={['pg-edge-path', data?.dashed === true ? 'is-dashed' : ''].filter(Boolean).join(' ')}
      d={data?.d ?? ''}
      fill="none"
    />
  )
}

const NODE_TYPES: NodeTypes = { pgCard: Card, pgUniverse: UniverseCard }
const EDGE_TYPES: EdgeTypes = { pgEdge: PgEdge }

interface Structure {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  /** Stable signature: layout only reruns when the graph's shape changes. */
  signature: string
}

function structureOf(nodes: readonly NodeView[]): Structure {
  const layoutNodes: LayoutNode[] = []
  const layoutEdges: LayoutEdge[] = []
  for (const node of nodes) {
    if (node.universe !== undefined) {
      layoutNodes.push({ id: `${UNIVERSE_PREFIX}${node.code}`, universe: true })
      layoutEdges.push({ id: `${UNIVERSE_PREFIX}${node.code}->${node.code}`, parent: `${UNIVERSE_PREFIX}${node.code}`, child: node.code, role: 'base' })
    }
    layoutNodes.push({ id: node.code })
    for (const parent of node.parents) {
      layoutEdges.push({ id: `${parent.code}->${node.code}:${parent.role}`, parent: parent.code, child: node.code, role: parent.role === 'remove' ? 'subtract' : 'base' })
    }
  }
  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    signature: JSON.stringify([layoutNodes.map(node => node.id), layoutEdges.map(edge => edge.id)]),
  }
}

/** Zoom bounds and the padding `fitView` leaves around the graph. */
const MIN_ZOOM = 0.35
const MAX_ZOOM = 1.2
const FIT_PADDING = 0.08
/** Viewport slide when the detail pane opens or closes; the pane fades over the same 200ms. */
const PANE_SLIDE_MS = 200
const easeOut = (t: number): number => 1 - (1 - t) ** 3

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Apply a viewport handed over from the other canvas exactly once, then report back. */
function InitialViewport({ viewport, onApplied }: { viewport: Viewport, onApplied?: () => void }): null {
  const { setViewport } = useReactFlow()
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    void setViewport(viewport).then(() => onApplied?.())
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * Keep the content anchored to the right edge when the detail pane takes or
 * gives back its width: the width change is added to `viewport.x` and slid
 * over 200ms, so no card jumps under the pointer. Only the change right after
 * the pane flips is compensated; window resizes keep the default.
 */
function PaneAnchor({ open }: { open: boolean }): null {
  const { getViewport, setViewport } = useReactFlow()
  const width = useStore(state => state.width)
  const previousWidth = useRef(width)
  const previousOpen = useRef(open)
  const armed = useRef(false)
  useLayoutEffect(() => {
    if (previousOpen.current === open) return
    previousOpen.current = open
    armed.current = true
  }, [open])
  useLayoutEffect(() => {
    const delta = width - previousWidth.current
    previousWidth.current = width
    if (!armed.current || delta === 0) return
    armed.current = false
    const from = getViewport()
    void setViewport({ ...from, x: from.x + delta }, reducedMotion() ? { duration: 0 } : { duration: PANE_SLIDE_MS, ease: easeOut, interpolate: 'linear' })
  }, [width, getViewport, setViewport])
  return null
}

export function BuildGraph({
  nodes: views,
  selectedCode,
  onSelect,
  onInspect,
  focusCode,
  initialViewport,
  onInitialViewportApplied,
  onViewportChange,
  zoomOnScroll = false,
  rightPaneOpen,
  className,
  t,
}: {
  nodes: readonly NodeView[]
  selectedCode: string | null
  onSelect: (code: string) => void
  onInspect?: (code: string) => void
  /** Open centred on this card instead of framing the whole graph. */
  focusCode?: string | null
  /** One-time starting viewport (the expanded dialog hands its camera back); skips the fit. */
  initialViewport?: Viewport | null
  onInitialViewportApplied?: () => void
  /** Reported after the user pans or zooms. */
  onViewportChange?: (viewport: Viewport) => void
  /** Wheel, pinch and double-click zoom; the wheel over the canvas then zooms instead of scrolling the pane. */
  zoomOnScroll?: boolean
  /** Whether the dialog's detail pane is open; given only there, it enables the right-edge anchor. */
  rightPaneOpen?: boolean
  className?: string
  t?: (key: string) => string
}): JSX.Element {
  const [layout, setLayout] = useState<LayoutResult | null>(null)
  const tr = translator(t)
  const structure = useMemo(() => structureOf(views), [views])
  const signature = structure.signature

  useEffect(() => {
    let alive = true
    layoutGraph(structure.nodes, structure.edges)
      .then((result) => { if (alive) setLayout(result) })
      .catch((error: unknown) => { console.error('[parallax] layout failed:', error) })
    return () => { alive = false }
    // Counts and job states change on every poll; only a new shape needs ELK.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const ports = useMemo(() => {
    const computed = computeInPorts(structure.nodes, structure.edges)
    const outgoing = new Map<string, number>()
    for (const edge of structure.edges) outgoing.set(edge.parent, (outgoing.get(edge.parent) ?? 0) + 1)
    return { inCount: computed.inCount, inIndexOf: computed.inIndexOf, outCount: outgoing }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const byCode = useMemo(() => new Map(views.map(view => [view.code, view])), [views])

  const nodes = useMemo<Array<Node<CardData>>>(() => {
    if (layout === null) return []
    return structure.nodes.flatMap((item) => {
      const position = layout.positions.get(item.id)
      if (position === undefined) return []
      const common = {
        selected: item.id === selectedCode,
        inCount: ports.inCount.get(item.id) ?? 0,
        outCount: ports.outCount.get(item.id) ?? 0,
        tr,
      }
      if (item.universe === true) {
        const owner = byCode.get(item.id.slice(UNIVERSE_PREFIX.length))
        return [{ id: item.id, type: 'pgUniverse', position, draggable: false, selectable: false, data: { ...common, universe: owner === undefined ? '' : describeUniverse(owner, tr) } } as Node<CardData>]
      }
      const node = byCode.get(item.id)
      if (node === undefined) return []
      return [{ id: item.id, type: 'pgCard', position, draggable: false, data: { ...common, node, onInspect } } as Node<CardData>]
    })
  }, [layout, structure, selectedCode, ports, onInspect, tr, byCode])

  const edges = useMemo<Edge[]>(() => {
    if (layout === null) return []
    return structure.edges.map((edge) => ({
      id: edge.id,
      source: edge.parent,
      target: edge.child,
      sourceHandle: 'out',
      targetHandle: `in-${ports.inIndexOf.get(edge.child)?.get(edge.parent) ?? 0}`,
      type: 'pgEdge',
      data: { d: roundedPolylinePath(layout.paths.get(edge.id) ?? []), dashed: edge.role === 'subtract' },
      selectable: false,
    }))
  }, [layout, structure, ports])

  // Read once, for the graph shape they were given with: a later handoff or focus
  // must not move a camera the user has taken over, and a new shape (ReactFlow
  // remounts per signature) frames the whole graph again.
  const [entry] = useState(() => ({
    signature,
    handoff: initialViewport ?? null,
    focus: focusCode !== undefined && focusCode !== null && views.some(view => view.code === focusCode) ? focusCode : null,
  }))
  const handoff = entry.signature === signature ? entry.handoff : null
  const focus = entry.signature === signature ? entry.focus : null

  return (
    <div className={['pg-canvas', className ?? ''].filter(Boolean).join(' ')}>
      {layout === null ? null : (
        <ReactFlow
          key={signature}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView={handoff === null}
          fitViewOptions={focus === null ? { padding: FIT_PADDING } : { nodes: [{ id: focus }], padding: 0.12, minZoom: MIN_ZOOM, maxZoom: 1 }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll={zoomOnScroll}
          zoomOnPinch={zoomOnScroll}
          zoomOnDoubleClick={zoomOnScroll}
          preventScrolling={zoomOnScroll}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            if (node.type === 'pgCard') onSelect(node.id)
          }}
          onMoveEnd={onViewportChange === undefined ? undefined : (_, viewport) => { onViewportChange(viewport) }}
        >
          <Controls showInteractive={false} position="bottom-right" />
          {handoff !== null ? <InitialViewport viewport={handoff} onApplied={onInitialViewportApplied} /> : null}
          {rightPaneOpen === undefined ? null : <PaneAnchor open={rightPaneOpen} />}
        </ReactFlow>
      )}
    </div>
  )
}
