export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-muted">
      <span
        className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand"
        aria-hidden
      />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}
