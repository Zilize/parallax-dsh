/** The Parallax brand mark: an isometric cube. */

const FACES = [
  { points: '32,6 54.5,19 32,32 9.5,19', gray: '#D0D0D0', opacity: 0.45 },
  { points: '54.5,19 54.5,45 32,58 32,32', gray: '#A0A0A0', opacity: 0.7 },
  { points: '9.5,19 32,32 32,58 9.5,45', gray: '#686868', opacity: 0.95 },
]

/**
 * `gray` paints the fixed brand shades; `current` tints the faces with the
 * surrounding text color, for rows that recolor on hover or in dark mode.
 */
export function BrandMark({ size = 16, tone = 'gray' }: { size?: number, tone?: 'gray' | 'current' }): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden focusable="false">
      {FACES.map(face => tone === 'gray'
        ? <polygon key={face.points} points={face.points} fill={face.gray} />
        : <polygon key={face.points} points={face.points} fill="currentColor" opacity={face.opacity} />)}
    </svg>
  )
}
