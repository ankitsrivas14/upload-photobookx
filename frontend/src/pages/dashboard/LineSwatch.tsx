/** A chart key's line sample: dashed for a reference line (an average), solid for a data series. */
export function LineSwatch({ color, solid }: { color: string; solid?: boolean }) {
  return (
    <svg width="14" height="6" aria-hidden="true">
      <line x1="0" y1="3" x2="14" y2="3" stroke={color} strokeWidth={solid ? 2 : 1.5} strokeDasharray={solid ? undefined : '4 3'} />
    </svg>
  );
}
