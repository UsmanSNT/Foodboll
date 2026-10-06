export function ProgressBar({
  value,
  max,
  label,
  tone,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly tone?: 'warn' | 'full' | undefined;
}) {
  const percent = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <div className={tone ? `progress__bar progress__bar--${tone}` : 'progress__bar'} style={{ width: `${percent}%` }} />
    </div>
  );
}
