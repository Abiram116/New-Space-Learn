export function ConfigMissing() {
  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-2xl">
        🔌
      </span>
      <h1 className="font-display text-2xl font-semibold">Almost there</h1>
      <p className="text-sm text-muted">
        Space Learn needs a Supabase URL and anon key to sign you in. Add these
        to your <code className="rounded bg-line-soft px-1.5 py-0.5 text-xs">.env</code> at the repo
        root and restart the dev server:
      </p>
      <pre className="w-full overflow-x-auto rounded-xl border-[1.5px] border-line bg-surface p-4 text-left text-xs">
        {`VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY`}
      </pre>
      <p className="text-xs text-faint">
        You can find both in your Supabase dashboard under Settings → API.
      </p>
    </div>
  )
}
