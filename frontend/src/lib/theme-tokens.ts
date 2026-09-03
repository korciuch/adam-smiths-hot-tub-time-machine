'use client'

/**
 * Canvas charts cannot use `var(--series-1)` - lightweight-charts paints to a
 * canvas, so colors have to be resolved to concrete values. These helpers read
 * the same custom properties defined in `globals.css`, keeping one source of
 * truth for the palette and getting the correct light/dark step for free.
 */

import { MAX_SERIES } from './series'

export type ChartTokens = {
  surface: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  gridline: string
  axis: string
  series: string[]
}

function readVar(styles: CSSStyleDeclaration, name: string) {
  return styles.getPropertyValue(name).trim()
}

export function readChartTokens(): ChartTokens {
  const styles = getComputedStyle(document.documentElement)
  return {
    surface: readVar(styles, '--surface-1'),
    textPrimary: readVar(styles, '--text-primary'),
    textSecondary: readVar(styles, '--text-secondary'),
    textMuted: readVar(styles, '--text-muted'),
    gridline: readVar(styles, '--gridline'),
    axis: readVar(styles, '--axis'),
    series: Array.from({ length: MAX_SERIES }, (_, i) =>
      readVar(styles, `--series-${i + 1}`),
    ),
  }
}

/**
 * Runs `onChange` whenever the resolved palette changes - OS scheme flip or an
 * explicit `data-theme` stamp on <html>.
 */
export function watchTheme(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', onChange)

  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  return () => {
    media.removeEventListener('change', onChange)
    observer.disconnect()
  }
}
