/** Deterministic colour per person, so the same player always looks the same without photos. */
function hueOf(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) % 360;
  return hash;
}

function initialsOf(name: string): string {
  const parts = name.normalize('NFC').trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? '?')][0] ?? '?';
  const second = parts.length > 1 ? ([...(parts[parts.length - 1] ?? '')][0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function Avatar({
  name,
  id,
  size = 'md',
}: {
  readonly name: string;
  readonly id: string;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return (
    <span
      className={size === 'md' ? 'avatar' : `avatar avatar--${size}`}
      style={{ '--hue': hueOf(id) } as React.CSSProperties}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
