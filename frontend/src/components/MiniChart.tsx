'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { toPlotRows, type AiRow, type ChartSpec } from '@/lib/ai/chart-spec'
import { readChartTokens, watchTheme, type ChartTokens } from '@/lib/theme-tokens'

/**
 * Small SVG chart for AI results.
 *
 * Deliberately not lightweight-charts: these are one-off, often categorical
 * results with no zoom or pan requirement, and a canvas chart cannot be read by
 * a screen reader or copied out. Plain SVG plus the palette tokens keeps it
 * consistent with the main chart without a second charting runtime.
 */

const HEIGHT = 220
const PAD = { top: 10, right: 14, bottom: 28, left: 52 }
const BAR_GAP = 2
/** Rounded data-end radius; bars are anchored to the baseline, so only the top rounds. */
const BAR_RADIUS = 4

type Props = { spec: ChartSpec; rows: AiRow[] }

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min]
  const raw = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let value = start; value <= max + step / 1000; value += step) {
    ticks.push(Number(value.toFixed(10)))
  }
  return ticks
}

const axisFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const valueFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/**
 * Bar anchored to the baseline, rounded only on the data end. `dataEnd` is the
 * value's pixel position and `baseline` is zero's, so a negative bar rounds
 * downward without any special-casing at the call site.
 */
function barPath(x: number, dataEnd: number, width: number, baseline: number) {
  const height = Math.abs(baseline - dataEnd)
  if (height < 0.5) return ''

  const r = Math.min(BAR_RADIUS, width / 2, height)
  const sign = dataEnd < baseline ? 1 : -1 // 1 = bar grows upward
  const corner = dataEnd + sign * r

  return [
    `M${x},${baseline}`,
    `V${corner}`,
    `Q${x},${dataEnd} ${x + r},${dataEnd}`,
    `H${x + width - r}`,
    `Q${x + width},${dataEnd} ${x + width},${corner}`,
    `V${baseline}`,
    'Z',
  ].join(' ')
}

export function MiniChart({ spec, rows }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [tokens, setTokens] = useState<ChartTokens | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setTokens(readChartTokens())
    const stopWatching = watchTheme(() => setTokens(readChartTokens()))

    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(container)

    return () => {
      stopWatching()
      observer.disconnect()
    }
  }, [])

  const points = useMemo(() => toPlotRows(spec, rows), [spec, rows])

  const scale = useMemo(() => {
    const values = points.flatMap((point) =>
      point.values.filter((value): value is number => value !== null),
    )
    if (values.length === 0) return null

    let min = Math.min(...values)
    let max = Math.max(...values)
    // Bars encode magnitude by length, so zero has to be on the scale.
    if (spec.kind === 'bar') {
      min = Math.min(0, min)
      max = Math.max(0, max)
    }
    if (min === max) {
      min -= 1
      max += 1
    } else if (spec.kind === 'line') {
      const headroom = (max - min) * 0.08
      min -= headroom
      max += headroom
    }
    return { min, max }
  }, [points, spec.kind])

  if (!scale || points.length === 0) return null

  const plotWidth = Math.max(width - PAD.left - PAD.right, 0)
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const baseline = PAD.top + plotHeight

  const y = (value: number) =>
    PAD.top + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight

  const groupWidth = plotWidth / points.length
  const xCenter = (index: number) => PAD.left + groupWidth * (index + 0.5)

  const colors = tokens?.series ?? []
  const ticks = niceTicks(scale.min, scale.max)

  // Show at most six x labels; a dense categorical axis is unreadable otherwise.
  const labelStride = Math.max(1, Math.ceil(points.length / 6))

  const directLabel = spec.series.length <= 4 && spec.kind === 'line'

  return (
    <figure className="m-0">
      {spec.title && (
        <figcaption className="mb-1 px-1 text-sm font-medium">{spec.title}</figcaption>
      )}

      {/* Legend is always present for 2+ series; a single series is named by the title. */}
      {spec.series.length > 1 && (
        <ul className="mb-1 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs">
          {spec.series.map((entry, index) => (
            <li key={entry.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-[8px] rounded-full"
                style={{ backgroundColor: colors[index % (colors.length || 1)] }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      <div ref={containerRef} className="relative w-full">
        {width > 0 && tokens && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={spec.title ?? `${spec.kind} chart of ${spec.series.map((s) => s.label).join(', ')}`}
            onMouseLeave={() => setHover(null)}
          >
            {/* Recessive gridlines and value axis. */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke={tokens.gridline}
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill={tokens.textMuted}
                >
                  {axisFormat.format(tick)}
                </text>
              </g>
            ))}

            <line
              x1={PAD.left}
              x2={PAD.left + plotWidth}
              y1={baseline}
              y2={baseline}
              stroke={tokens.axis}
              strokeWidth={1}
            />

            {points.map((point, index) =>
              index % labelStride === 0 ? (
                <text
                  key={point.label + index}
                  x={xCenter(index)}
                  y={baseline + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill={tokens.textMuted}
                >
                  {point.label.length > 10 ? `${point.label.slice(0, 9)}…` : point.label}
                </text>
              ) : null,
            )}

            {spec.kind === 'bar'
              ? spec.series.map((entry, seriesIndex) => {
                  const slotWidth = Math.max(
                    (groupWidth - 6) / spec.series.length - BAR_GAP,
                    1,
                  )
                  return (
                    <g key={entry.key} fill={colors[seriesIndex % (colors.length || 1)]}>
                      {points.map((point, index) => {
                        const value = point.values[seriesIndex]
                        if (value === null) return null
                        const groupStart =
                          xCenter(index) - ((slotWidth + BAR_GAP) * spec.series.length) / 2
                        const x = groupStart + seriesIndex * (slotWidth + BAR_GAP)
                        return (
                          <path key={index} d={barPath(x, y(value), slotWidth, y(0))} />
                        )
                      })}
                    </g>
                  )
                })
              : spec.series.map((entry, seriesIndex) => {
                  const color = colors[seriesIndex % (colors.length || 1)]
                  const segments: string[] = []
                  let open = false
                  points.forEach((point, index) => {
                    const value = point.values[seriesIndex]
                    if (value === null) {
                      open = false
                      return
                    }
                    segments.push(`${open ? 'L' : 'M'}${xCenter(index)},${y(value)}`)
                    open = true
                  })
                  const lastIndex = points.findLastIndex(
                    (point) => point.values[seriesIndex] !== null,
                  )
                  const lastValue =
                    lastIndex >= 0 ? points[lastIndex].values[seriesIndex] : null

                  return (
                    <g key={entry.key}>
                      <path
                        d={segments.join(' ')}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Direct label at the series end, so identity is not color-alone. */}
                      {directLabel && lastValue !== null && (
                        <text
                          x={xCenter(lastIndex) + 6}
                          y={y(lastValue)}
                          dominantBaseline="middle"
                          fontSize={11}
                          fill={tokens.textSecondary}
                        >
                          {entry.label}
                        </text>
                      )}
                    </g>
                  )
                })}

            {/* Hover band per category: a hit target far larger than the mark. */}
            {points.map((point, index) => (
              <rect
                key={`hit-${index}`}
                x={PAD.left + groupWidth * index}
                y={PAD.top}
                width={groupWidth}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
            ))}

            {hover !== null && (
              <g pointerEvents="none">
                <line
                  x1={xCenter(hover)}
                  x2={xCenter(hover)}
                  y1={PAD.top}
                  y2={baseline}
                  stroke={tokens.axis}
                  strokeWidth={1}
                />
                {spec.series.map((entry, seriesIndex) => {
                  const value = points[hover].values[seriesIndex]
                  if (value === null) return null
                  return (
                    <circle
                      key={entry.key}
                      cx={xCenter(hover)}
                      cy={y(value)}
                      r={4}
                      fill={colors[seriesIndex % (colors.length || 1)]}
                      // 2px surface ring keeps overlapping markers readable.
                      stroke={tokens.surface}
                      strokeWidth={2}
                    />
                  )
                })}
              </g>
            )}
          </svg>
        )}

        {hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs shadow-lg"
            style={{
              left: Math.min(xCenter(hover) + 10, Math.max(width - 150, 0)),
            }}
          >
            <div className="mb-1 text-[var(--text-secondary)]">{points[hover].label}</div>
            {spec.series.map((entry, seriesIndex) => {
              const value = points[hover].values[seriesIndex]
              return (
                <div key={entry.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-[8px] rounded-full"
                    style={{ backgroundColor: colors[seriesIndex % (colors.length || 1)] }}
                  />
                  <span>{entry.label}</span>
                  <span className="tnum ml-auto pl-3">
                    {value === null ? '—' : valueFormat.format(value)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </figure>
  )
}
