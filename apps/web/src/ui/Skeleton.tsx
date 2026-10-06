export function Skeleton({ height = 16, width = '100%' }: { readonly height?: number; readonly width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

/** Placeholder rows shown while a list loads. */
export function ListSkeleton({ rows = 3, height = 112 }: { readonly rows?: number; readonly height?: number }) {
  return (
    <div className="stack" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}
