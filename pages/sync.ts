import gatsbyText from './gatsby.txt' with { type: 'text' }
import mixedAppText from '../corpora/mixed-app-text.txt' with { type: 'text' }
import {
  layoutWithLines,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type LayoutLinesResult,
  type PreparedTextWithSegments,
} from '../src/layout.ts'

const FONT = '20px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const LINE_HEIGHT = 32

const MIXED_EXCERPT = [
  mixedAppText.trim(),
  '“We can reflow this and still keep the same anchor,” Nora wrote, pasting',
  'https://pretext.dev/notes?mode=reflow beside a trans\u00ADatlantic aside and',
  'a Thai quote, ทูลว่า "พระองค์", just to make sure the cursor stays honest.',
].join(' ')

const GATSBY_EXCERPT = gatsbyText
  .split(/\n\s*\n/u)
  .map(paragraph => paragraph.trim())
  .filter(Boolean)
  .slice(0, 18)
  .join(' ')

const TEXTS = {
  gatsby: GATSBY_EXCERPT,
  mixed: MIXED_EXCERPT,
} as const

type ExcerptKey = keyof typeof TEXTS

type Pane = {
  key: 'a' | 'b' | 'c'
  widthInput: HTMLInputElement
  viewport: HTMLDivElement
  stage: HTMLDivElement
  head: HTMLElement
  meta: HTMLElement
  stat: HTMLElement
  lineElements: HTMLDivElement[]
  lines: LayoutLine[]
}

const excerptInput = document.getElementById('excerpt') as HTMLSelectElement
const viewportHeightInput = document.getElementById('viewport-height') as HTMLInputElement

const panes: Pane[] = [
  {
    key: 'a',
    widthInput: document.getElementById('pane-a-width') as HTMLInputElement,
    viewport: document.getElementById('pane-a-viewport') as HTMLDivElement,
    stage: document.getElementById('pane-a-stage') as HTMLDivElement,
    head: document.getElementById('pane-a-head')!,
    meta: document.getElementById('pane-a-meta')!,
    stat: document.getElementById('stat-lines-a')!,
    lineElements: [],
    lines: [],
  },
  {
    key: 'b',
    widthInput: document.getElementById('pane-b-width') as HTMLInputElement,
    viewport: document.getElementById('pane-b-viewport') as HTMLDivElement,
    stage: document.getElementById('pane-b-stage') as HTMLDivElement,
    head: document.getElementById('pane-b-head')!,
    meta: document.getElementById('pane-b-meta')!,
    stat: document.getElementById('stat-lines-b')!,
    lineElements: [],
    lines: [],
  },
  {
    key: 'c',
    widthInput: document.getElementById('pane-c-width') as HTMLInputElement,
    viewport: document.getElementById('pane-c-viewport') as HTMLDivElement,
    stage: document.getElementById('pane-c-stage') as HTMLDivElement,
    head: document.getElementById('pane-c-head')!,
    meta: document.getElementById('pane-c-meta')!,
    stat: document.getElementById('stat-lines-c')!,
    lineElements: [],
    lines: [],
  },
]

const statAnchor = document.getElementById('stat-anchor')!
const anchorMeta = document.getElementById('anchor-meta')!

const preparedByKey: Partial<Record<ExcerptKey, PreparedTextWithSegments>> = {}
let syncing = false

function getPrepared(key: ExcerptKey): PreparedTextWithSegments {
  const cached = preparedByKey[key]
  if (cached !== undefined) return cached
  const prepared = prepareWithSegments(TEXTS[key], FONT)
  preparedByKey[key] = prepared
  return prepared
}

function compareCursor(a: LayoutCursor, b: LayoutCursor): number {
  if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex
  return a.graphemeIndex - b.graphemeIndex
}

function findAnchorLineIndex(lines: LayoutLine[], target: LayoutCursor): number {
  let low = 0
  let high = lines.length - 1
  let result = 0

  while (low <= high) {
    const mid = (low + high) >> 1
    const line = lines[mid]!
    const cmp = compareCursor(line.start, target)
    if (cmp <= 0) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

function formatCursor(cursor: LayoutCursor): string {
  return `${cursor.segmentIndex}:${cursor.graphemeIndex}`
}

function setViewportHeight(height: number): void {
  for (const pane of panes) {
    pane.viewport.style.height = `${height}px`
  }
}

function setActiveAnchor(pane: Pane | null, lineIndex: number): void {
  for (const candidate of panes) {
    for (let i = 0; i < candidate.lineElements.length; i++) {
      candidate.lineElements[i]!.classList.toggle(
        'is-anchor',
        pane !== null && candidate === pane && i === lineIndex,
      )
    }
  }
}

function describeLine(line: LayoutLine): string {
  return `${line.text} • ${formatCursor(line.start)}→${formatCursor(line.end)} • ${line.width.toFixed(2)}px` +
    (line.trailingDiscretionaryHyphen ? ' • discretionary hyphen' : '')
}

function renderPane(pane: Pane, laidOut: LayoutLinesResult, width: number): void {
  pane.lines = laidOut.lines
  pane.stage.replaceChildren()
  pane.lineElements = []
  pane.stage.style.width = `${width}px`
  pane.stage.style.height = `${laidOut.height}px`
  pane.head.textContent = `${width}px`
  pane.stat.textContent = String(laidOut.lineCount)

  for (let i = 0; i < laidOut.lines.length; i++) {
    const line = laidOut.lines[i]!
    const el = document.createElement('div')
    el.className = 'line'
    el.textContent = line.text
    el.style.top = `${i * LINE_HEIGHT}px`
    el.title = describeLine(line)
    el.addEventListener('mouseenter', () => {
      setActiveAnchor(pane, i)
      statAnchor.textContent = formatCursor(line.start)
      anchorMeta.textContent = `Hover anchor from pane ${pane.key.toUpperCase()}: ${describeLine(line)}`
    })
    pane.stage.appendChild(el)
    pane.lineElements.push(el)
  }

  const first = laidOut.lines[0]
  const last = laidOut.lines[laidOut.lines.length - 1]
  pane.meta.textContent = first === undefined || last === undefined
    ? 'No lines'
    : `${laidOut.lineCount} lines • ${formatCursor(first.start)} … ${formatCursor(last.start)}`
}

function syncFrom(source: Pane): void {
  if (syncing) return
  const sourceLines = source.lines
  if (sourceLines.length === 0) return

  const rawIndex = Math.floor(source.viewport.scrollTop / LINE_HEIGHT)
  const sourceIndex = Math.max(0, Math.min(rawIndex, sourceLines.length - 1))
  const sourceLine = sourceLines[sourceIndex]!
  const intraLineOffset = source.viewport.scrollTop - sourceIndex * LINE_HEIGHT

  syncing = true
  try {
    setActiveAnchor(source, sourceIndex)
    statAnchor.textContent = formatCursor(sourceLine.start)
    anchorMeta.textContent =
      `Pane ${source.key.toUpperCase()} is anchoring the shared cursor ${formatCursor(sourceLine.start)}. ` +
      `Other panes are snapped to the nearest line that begins at or before that cursor.`

    for (const pane of panes) {
      if (pane === source) continue
      const targetIndex = findAnchorLineIndex(pane.lines, sourceLine.start)
      pane.viewport.scrollTop = targetIndex * LINE_HEIGHT + intraLineOffset
    }
  } finally {
    syncing = false
  }
}

function render(): void {
  const excerpt = excerptInput.value as ExcerptKey
  const prepared = getPrepared(excerpt)
  const viewportHeight = parseInt(viewportHeightInput.value, 10)

  setViewportHeight(viewportHeight)

  for (const pane of panes) {
    const width = parseInt(pane.widthInput.value, 10)
    const laidOut = layoutWithLines(prepared, width, LINE_HEIGHT)
    renderPane(pane, laidOut, width)
  }

  const fallbackPane = panes[1]!
  fallbackPane.viewport.scrollTop = 0
  syncFrom(fallbackPane)
}

for (const pane of panes) {
  pane.viewport.addEventListener('scroll', () => syncFrom(pane))
  pane.widthInput.addEventListener('input', render)
}

excerptInput.addEventListener('change', render)
viewportHeightInput.addEventListener('input', render)

render()
