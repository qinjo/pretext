import { layoutNextLine, prepareWithSegments, type LayoutCursor, type PreparedTextWithSegments } from '../src/layout.ts'

const BODY_FONT = '20px "Helvetica Neue", Helvetica, Arial, sans-serif'
const BODY_LINE_HEIGHT = 31
const MOBILE_BODY_FONT = '17px "Helvetica Neue", Helvetica, Arial, sans-serif'
const MOBILE_BODY_LINE_HEIGHT = 27

const LEFT_COPY = `
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc mollis, enim sed fermentum mattis, arcu felis dignissim neque, ut tincidunt neque ipsum in ligula. Sed viverra rutrum nunc, a tempor nulla feugiat at. Morbi placerat, nibh non volutpat feugiat, nibh mauris ultrices nibh, vitae feugiat dolor odio eget nisi.

Praesent imperdiet justo vel mi cursus, nec pulvinar risus porttitor. Etiam pretium dictum dolor, vitae malesuada lorem convallis ut. Donec ornare diam at velit dictum, sed pharetra lorem pulvinar. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; In ac dui vel metus volutpat gravida.
`.trim().replace(/\s+/gu, ' ') + ' ' + `
Sed non nibh ut ipsum tempor iaculis. Cras at mauris vitae lorem volutpat vulputate. Pellentesque ac dui at mauris luctus pretium. Mauris malesuada, mi vitae pretium efficitur, purus neque volutpat lectus, vel suscipit enim nulla a risus. Nulla facilisi. Duis elementum volutpat augue, vitae placerat enim faucibus vel.
`.trim().replace(/\s+/gu, ' ')

const RIGHT_COPY = `
Vestibulum faucibus posuere neque, eget accumsan eros malesuada ut. Integer non massa lacus. Donec non eros vel augue auctor suscipit. Aliquam aliquet purus vitae mauris luctus, sed egestas neque consequat. Curabitur commodo velit vitae mi placerat, quis gravida sem fermentum.

Suspendisse luctus, mauris non gravida suscipit, justo felis rhoncus arcu, et luctus neque mi non lacus. Mauris sed semper felis. Nunc vulputate magna quis arcu interdum, quis placerat mauris ultrices. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.
`.trim().replace(/\s+/gu, ' ') + ' ' + `
Fusce viverra magna vel nibh interdum, non rhoncus eros consequat. Maecenas sed justo neque. Donec ac nisl interdum, vulputate quam id, blandit massa. Quisque convallis dictum sem, in finibus dolor vestibulum et. Integer vulputate semper augue, sed ultrices nunc eleifend id.
`.trim().replace(/\s+/gu, ' ')

type Rect = {
  x: number
  y: number
  width: number
  height: number
}

type Interval = {
  left: number
  right: number
}

type MaskRow = {
  left: number
  right: number
}

type ImageMask = {
  width: number
  height: number
  rows: Array<MaskRow | null>
}

const stage = document.getElementById('stage') as HTMLDivElement
const headline = document.getElementById('headline') as HTMLHeadingElement
const openaiLogo = document.getElementById('openai-logo') as HTMLImageElement
const claudeLogo = document.getElementById('claude-logo') as HTMLImageElement

const preparedByKey = new Map<string, PreparedTextWithSegments>()
const scheduled = { value: false }

function getTypography(): { font: string, lineHeight: number } {
  if (window.innerWidth <= 900) {
    return { font: MOBILE_BODY_FONT, lineHeight: MOBILE_BODY_LINE_HEIGHT }
  }
  return { font: BODY_FONT, lineHeight: BODY_LINE_HEIGHT }
}

function getPrepared(text: string, font: string): PreparedTextWithSegments {
  const key = `${font}::${text}`
  const cached = preparedByKey.get(key)
  if (cached !== undefined) return cached
  const prepared = prepareWithSegments(text, font)
  preparedByKey.set(key, prepared)
  return prepared
}

async function makeImageMask(src: string, width: number, height: number): Promise<ImageMask> {
  const image = new Image()
  image.src = src
  await image.decode()

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('2d context unavailable')

  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)

  const { data } = ctx.getImageData(0, 0, width, height)
  const rows: Array<MaskRow | null> = new Array(height)

  for (let y = 0; y < height; y++) {
    let left = width
    let right = -1
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]!
      if (alpha < 12) continue
      if (x < left) left = x
      if (x > right) right = x
    }
    rows[y] = right >= left ? { left, right: right + 1 } : null
  }

  return { width, height, rows }
}

function getMaskIntervalForBand(
  mask: ImageMask,
  rect: Rect,
  bandTop: number,
  bandBottom: number,
  horizontalPadding: number,
  verticalPadding: number,
): Interval | null {
  if (bandBottom <= rect.y || bandTop >= rect.y + rect.height) return null

  const startRow = Math.max(0, Math.floor(bandTop - rect.y - verticalPadding))
  const endRow = Math.min(mask.height - 1, Math.ceil(bandBottom - rect.y + verticalPadding))

  let left = mask.width
  let right = -1

  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
    const row = mask.rows[rowIndex]
    if (row === null || row === undefined) continue
    if (row.left < left) left = row.left
    if (row.right > right) right = row.right
  }

  if (right < left) return null

  return {
    left: rect.x + left - horizontalPadding,
    right: rect.x + right + horizontalPadding,
  }
}

function subtractIntervals(base: Interval, intervals: Interval[]): Interval[] {
  let slots: Interval[] = [base]

  for (const interval of intervals) {
    const next: Interval[] = []
    for (const slot of slots) {
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) {
        next.push({ left: slot.left, right: interval.left })
      }
      if (interval.right < slot.right) {
        next.push({ left: interval.right, right: slot.right })
      }
    }
    slots = next
  }

  return slots.filter(slot => slot.right - slot.left >= 24)
}

function renderColumn(
  prepared: PreparedTextWithSegments,
  region: Rect,
  font: string,
  lineHeight: number,
  maskRect: Rect,
  mask: ImageMask,
  maskPadding: { horizontal: number, vertical: number },
  lineClassName: string,
  side: 'left' | 'right',
): void {
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineTop = region.y

  while (true) {
    if (lineTop + lineHeight > region.y + region.height) break

    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    const blocked: Interval[] = []
    const maskInterval = getMaskIntervalForBand(
      mask,
      maskRect,
      bandTop,
      bandBottom,
      maskPadding.horizontal,
      maskPadding.vertical,
    )
    if (maskInterval !== null) blocked.push(maskInterval)

    const slots = subtractIntervals(
      { left: region.x, right: region.x + region.width },
      blocked,
    )
    if (slots.length === 0) {
      lineTop += lineHeight
      continue
    }

    const slot = side === 'left'
      ? slots[slots.length - 1]!
      : slots[0]!
    const width = slot.right - slot.left
    const line = layoutNextLine(prepared, cursor, width)
    if (line === null) break

    const el = document.createElement('div')
    el.className = lineClassName
    el.textContent = line.text
    el.style.left = `${Math.round(slot.left)}px`
    el.style.top = `${Math.round(lineTop)}px`
    el.style.font = font
    el.style.lineHeight = `${lineHeight}px`
    stage.appendChild(el)

    cursor = line.end
    lineTop += lineHeight
  }
}

function clearRenderedLines(): void {
  const lines = stage.querySelectorAll('.line')
  lines.forEach(line => {
    line.remove()
  })
}

async function render(): Promise<void> {
  const { font, lineHeight } = getTypography()
  const pageWidth = window.innerWidth
  const pageHeight = Math.max(window.innerHeight, 980)

  stage.style.minHeight = `${pageHeight}px`

  const gutter = Math.round(Math.max(56, pageWidth * 0.055))
  const centerGap = Math.round(Math.max(54, pageWidth * 0.058))
  const headlineTop = Math.round(Math.max(48, pageHeight * 0.07))
  const headlineWidth = Math.round(Math.min(pageWidth - gutter * 2, pageWidth * 0.62))
  const copyTop = headlineTop + Math.round(Math.max(174, pageWidth * 0.15))
  const columnWidth = Math.round((pageWidth - gutter * 2 - centerGap) / 2)
  const columnHeight = pageHeight - copyTop - gutter

  const leftRegion: Rect = {
    x: gutter,
    y: copyTop,
    width: columnWidth,
    height: columnHeight,
  }

  const rightRegion: Rect = {
    x: gutter + columnWidth + centerGap,
    y: copyTop,
    width: columnWidth,
    height: columnHeight,
  }

  const openaiSize = Math.round(Math.max(260, Math.min(420, pageWidth * 0.28)))
  const openaiRect: Rect = {
    x: leftRegion.x - Math.round(openaiSize * 0.16),
    y: pageHeight - gutter - openaiSize + Math.round(openaiSize * 0.02),
    width: openaiSize,
    height: openaiSize,
  }

  const claudeSize = Math.round(Math.max(250, Math.min(380, pageWidth * 0.25)))
  const claudeRect: Rect = {
    x: rightRegion.x + rightRegion.width - Math.round(claudeSize * 0.74),
    y: Math.round(Math.max(56, headlineTop + 4)),
    width: claudeSize,
    height: claudeSize,
  }

  headline.style.left = `${gutter}px`
  headline.style.top = `${headlineTop}px`
  headline.style.width = `${headlineWidth}px`

  openaiLogo.style.left = `${openaiRect.x}px`
  openaiLogo.style.top = `${openaiRect.y}px`
  openaiLogo.style.width = `${openaiRect.width}px`
  openaiLogo.style.height = `${openaiRect.height}px`

  claudeLogo.style.left = `${claudeRect.x}px`
  claudeLogo.style.top = `${claudeRect.y}px`
  claudeLogo.style.width = `${claudeRect.width}px`
  claudeLogo.style.height = `${claudeRect.height}px`

  clearRenderedLines()

  const [openaiMask, claudeMask] = await Promise.all([
    makeImageMask(openaiLogo.src, openaiRect.width, openaiRect.height),
    makeImageMask(claudeLogo.src, claudeRect.width, claudeRect.height),
  ])

  renderColumn(
    getPrepared(LEFT_COPY, font),
    leftRegion,
    font,
    lineHeight,
    openaiRect,
    openaiMask,
    { horizontal: Math.round(lineHeight * 0.75), vertical: Math.round(lineHeight * 0.3) },
    'line line--left',
    'left',
  )

  renderColumn(
    getPrepared(RIGHT_COPY, font),
    rightRegion,
    font,
    lineHeight,
    claudeRect,
    claudeMask,
    { horizontal: Math.round(lineHeight * 0.68), vertical: Math.round(lineHeight * 0.28) },
    'line line--right',
    'right',
  )
}

function scheduleRender(): void {
  if (scheduled.value) return
  scheduled.value = true
  requestAnimationFrame(() => {
    scheduled.value = false
    void render()
  })
}

window.addEventListener('resize', scheduleRender)
void document.fonts.ready.then(() => {
  scheduleRender()
})
scheduleRender()
