/**
 * The keys that work while reviewing cards and taking a quiz, in one place.
 * A reference, not a setting: it mirrors `flashcards/keys.ts` and
 * `quizzes/keys.ts`, so change it when those change.
 */

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: 'Reviewing cards',
    keys: [
      [['Space', 'Enter'], 'Flip the card, then confirm the highlighted grade'],
      [['←', '→'], 'Move between grades'],
      [['1', '–', '4'], 'Grade straight away'],
      [['Esc'], 'End the session'],
    ],
  },
  {
    title: 'Taking a quiz',
    keys: [
      [['↑', '↓'], 'Move between answers'],
      [['Enter', 'Space'], 'Choose the highlighted answer'],
      [['1', '–', '4'], 'Choose an answer straight away (A–D work too)'],
      [['→', 'N'], 'Next question, once answered'],
      [['Esc'], 'Leave the quiz'],
    ],
  },
]

export function Shortcuts() {
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[14px] text-ink [&::-webkit-details-marker]:hidden">
        Keyboard shortcuts
        <span className="text-[12.5px] text-muted group-open:hidden">Show</span>
        <span className="hidden text-[12.5px] text-muted group-open:inline">Hide</span>
      </summary>
      <div className="grid gap-5 border-t border-line-soft p-4 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="setcode mb-2 text-faint">{g.title}</div>
            <dl className="flex flex-col gap-2">
              {g.keys.map(([keys, what]) => (
                <div key={what} className="flex items-start gap-3 text-[13px]">
                  <dt className="flex w-[5.5rem] shrink-0 flex-wrap items-center gap-1">
                    {keys.map((k) =>
                      k === '–' ? (
                        <span key={k} className="text-faint">
                          –
                        </span>
                      ) : (
                        <kbd key={k} className="rounded-[6px] border border-line bg-well px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">
                          {k}
                        </kbd>
                      ),
                    )}
                  </dt>
                  <dd className="min-w-0 leading-snug text-muted">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  )
}
