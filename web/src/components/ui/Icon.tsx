/**
 * The icon set.
 *
 * One drawn family, 24px grid, 1.6 stroke, round caps and joins — no emoji
 * standing in for an icon. Everything inherits `currentColor` so an icon takes
 * the foil tone of whatever it sits inside.
 *
 * Shapes lean on the card world where there's a choice: a deck is a stack of
 * cards, a badge is a foil seal, a skill is a card with a figure on it.
 */

import type { SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'chat'
  | 'note'
  | 'deck'
  | 'quiz'
  | 'doc'
  | 'skill'
  | 'agent'
  | 'settings'
  | 'user'
  | 'plus'
  | 'minus'
  | 'search'
  | 'close'
  | 'trash'
  | 'upload'
  | 'check'
  | 'flame'
  | 'lock'
  | 'send'
  | 'stop'
  | 'collapse'
  | 'expand'
  | 'chevronRight'
  | 'chevronDown'
  | 'arrowRight'
  | 'arrowLeft'
  | 'refresh'
  | 'seal'
  | 'target'
  | 'clock'
  | 'sparkle'
  | 'offline'
  | 'alert'
  | 'more'
  | 'pin'
  | 'thumbUp'
  | 'thumbDown'
  | 'listBullet'
  | 'listOrdered'
  | 'listTodo'
  | 'quote'
  | 'code'
  | 'table'
  | 'pencil'
  | 'userEdit'
  | 'wrapLeft'
  | 'wrapNone'
  | 'wrapRight'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'copy'
  | 'help'
  // Subject glyphs (lib/subjectIcon.ts): one per broad field of study.
  | 'sigma'
  | 'atom'
  | 'flask'
  | 'leaf'
  | 'pulse'
  | 'globe'
  | 'landmark'
  | 'scale'
  | 'book'
  | 'language'
  | 'chart'
  | 'music'
  | 'palette'
  | 'brain'
  | 'cpu'
  | 'bolt'
  // Trust pages and the landing page's feature marks.
  | 'database'
  | 'eye'
  | 'mail'
  | 'citePage'
  | 'fanOut'
  | 'mortarboard'

type Props = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName
  size?: number
  /** Filled variants read as "earned" — use for unlocked badges, active streak. */
  filled?: boolean
}

export function Icon({ name, size = 18, filled = false, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths(name, filled)}
    </svg>
  )
}

function paths(name: IconName, filled: boolean) {
  switch (name) {
    case 'home':
      return (
        <>
          <path d="M4 10.5 12 4l8 6.5" />
          <path d="M6 9.8V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8" />
          <path d="M10 20v-5h4v5" />
        </>
      )
    case 'chat':
      return (
        <>
          <path d="M20 13.5A2.5 2.5 0 0 1 17.5 16H9l-4 3.5V7.5A2.5 2.5 0 0 1 7.5 5h10A2.5 2.5 0 0 1 20 7.5Z" />
          <path d="M9 10.5h7M9 13h4" />
        </>
      )
    case 'note':
      return (
        <>
          <path d="M6 3.5h8.5L19 8v12a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5Z" />
          <path d="M14 3.5V8h5" />
          <path d="M9 13h6M9 16.5h4" />
        </>
      )
    // A deck: two cards behind, one card in front, slightly fanned.
    case 'deck':
      return (
        <>
          <rect x="8.5" y="6" width="11" height="14" rx="1.6" />
          <path d="M15.5 4.5H6a1.5 1.5 0 0 0-1.5 1.5v11" />
          <path d="M12 11.5h4.5M12 14.5h3" />
        </>
      )
    /* Quiz: an answer sheet with one option marked.
       It used to be a question mark in a circle, which is the universal glyph
       for HELP — every support widget on the internet uses it. A quiz in this
       app is specifically multiple-choice, so the sheet says what it is: three
       options, the middle one chosen. */
    case 'quiz':
      return (
        <>
          <rect x="4" y="3.5" width="16" height="17" rx="2" />
          <circle cx="8.5" cy="9" r="1.4" />
          <circle cx="8.5" cy="14.5" r="1.4" fill={filled ? 'currentColor' : 'none'} />
          <path d="M12 9h4.5M12 14.5h4.5" />
        </>
      )
    case 'doc':
      return (
        <>
          <path d="M6.5 3.5h7L19 9v11.5a.5.5 0 0 1-.5.5h-12a.5.5 0 0 1-.5-.5v-16a.5.5 0 0 1 .5-.5Z" />
          <path d="M13 3.5V9h5.5" />
        </>
      )
    // Skill: a character card — a figure inside a card frame.
    case 'skill':
      return (
        <>
          <rect x="5" y="3.5" width="14" height="17" rx="1.8" />
          <circle cx="12" cy="10" r="2.2" />
          <path d="M8.6 16.8a3.6 3.6 0 0 1 6.8 0" />
        </>
      )
    // Agent: a bolt — a one-shot action, deliberately not card-shaped.
    case 'agent':
      return <path d="M13.4 3 6.5 13h4.6l-1.5 8 7.4-10.4h-4.7Z" fill={filled ? 'currentColor' : 'none'} />
    // Settings: a gear, with actual TEETH. It used to be a hub with eight
    // straight rays radiating off it, which is the universal glyph for
    // brightness — a sun — not for settings. The difference between the two
    // icons is entirely whether the spokes are rays (light) or notches
    // (machinery), so the outline steps in and out rather than spiking.
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3.1" />
          <path d="M19.3 13.5a7.7 7.7 0 0 0 0-3l2-1.5-1.9-3.3-2.3 1a7.7 7.7 0 0 0-2.6-1.5L14.2 2.7h-3.8l-.3 2.5a7.7 7.7 0 0 0-2.6 1.5l-2.3-1L3.3 9l2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5L5.2 18l2.3-1a7.7 7.7 0 0 0 2.6 1.5l.3 2.5h3.8l.3-2.5a7.7 7.7 0 0 0 2.6-1.5l2.3 1 1.9-3.3Z" />
        </>
      )
    case 'user':
      return (
        <>
          <circle cx="12" cy="8.5" r="3.6" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </>
      )
    case 'plus':
      return <path d="M12 5.5v13M5.5 12h13" />
    case 'minus':
      return <path d="M5.5 12h13" />
    /* Image placement, drawn as the layout it produces: a filled block for the
       picture and ruled lines for the text around it. The previous controls
       reused the text-alignment glyphs, which describe where a *paragraph*
       sits and say nothing about how text flows around a picture — the actual
       question. Word and Docs both draw the result rather than the alignment;
       so does this. */
    case 'wrapLeft':
      return (
        <>
          <rect x="3.5" y="7" width="8" height="10" rx="1.2" fill="currentColor" stroke="none" opacity="0.85" />
          <path d="M13.5 8.5h7M13.5 12h7M13.5 15.5h7" />
        </>
      )
    case 'wrapNone':
      return (
        <>
          <path d="M4 4.5h16" />
          <rect x="6" y="8" width="12" height="8" rx="1.2" fill="currentColor" stroke="none" opacity="0.85" />
          <path d="M4 19.5h16" />
        </>
      )
    case 'wrapRight':
      return (
        <>
          <path d="M3.5 8.5h7M3.5 12h7M3.5 15.5h7" />
          <rect x="12.5" y="7" width="8" height="10" rx="1.2" fill="currentColor" stroke="none" opacity="0.85" />
        </>
      )
    /* Alignment: ruled lines whose ragged edge shows the alignment, the way
       the text itself would sit. Long/short pairs rather than four equal
       rules, because equal rules read as a list, not as alignment. */
    case 'alignLeft':
      return (
        <>
          <path d="M4 6.5h16M4 11h10M4 15.5h16M4 20h10" />
        </>
      )
    case 'alignCenter':
      return (
        <>
          <path d="M4 6.5h16M7 11h10M4 15.5h16M7 20h10" />
        </>
      )
    case 'alignRight':
      return (
        <>
          <path d="M4 6.5h16M10 11h10M4 15.5h16M10 20h10" />
        </>
      )
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m15.8 15.8 4.2 4.2" />
        </>
      )
    case 'close':
      return <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    case 'trash':
      return (
        <>
          <path d="M4.5 6.5h15" />
          <path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
          <path d="M6.5 6.5 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-13.5" />
        </>
      )
    case 'upload':
      return (
        <>
          <path d="M12 15.5V4.5" />
          <path d="m7.8 8.7 4.2-4.2 4.2 4.2" />
          <path d="M4.5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />
        </>
      )
    case 'copy':
      return (
        <>
          <rect x="9.5" y="9.5" width="10" height="10" rx="1.6" />
          <path d="M14.5 9.5V6a1.6 1.6 0 0 0-1.6-1.6H6a1.6 1.6 0 0 0-1.6 1.6v6.9A1.6 1.6 0 0 0 6 14.5h3.5" />
        </>
      )
    case 'check':
      return <path d="m5 12.5 4.5 4.5L19 7.5" />
    // Flame: the streak mark. Two shapes rather than one — an outer body and
    // an inner tongue. The old single path tried to describe the whole flame
    // including its licks in one outline, which at 14px collapsed into an
    // indistinct blob. A clean silhouette plus a separate core reads as fire
    // at any size, and the core gives the earned/filled state somewhere to go.
    case 'flame':
      return (
        <>
          <path
            d="M12.5 2.6c.4 2.6 1.8 3.9 3.1 5.4 1.3 1.6 2 3.2 2 5.1a5.6 5.6 0 0 1-11.2 0c0-2.3 1-4.3 3-6.1-.1 1.4.3 2.4 1.3 3 .5-2.6.9-4.8 1.8-7.4Z"
            fill={filled ? 'currentColor' : 'none'}
          />
          <path
            d="M12 13.4c1 1.1 1.5 2 1.5 2.8a1.5 1.5 0 0 1-3 0c0-.8.5-1.7 1.5-2.8Z"
            fill={filled ? 'var(--color-canvas)' : 'none'}
          />
        </>
      )
    case 'lock':
      return (
        <>
          <rect x="5" y="10.5" width="14" height="9.5" rx="1.6" />
          <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
        </>
      )
    case 'send':
      return (
        <>
          <path d="M20 4 3.8 10.4a.4.4 0 0 0 .03.75l6.7 2.3 2.3 6.7a.4.4 0 0 0 .75.03Z" />
          <path d="m10.6 13.4 4.6-4.6" />
        </>
      )
    case 'stop':
      return <rect x="6.5" y="6.5" width="11" height="11" rx="1.6" fill={filled ? 'currentColor' : 'none'} />
    case 'collapse':
      return (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M10 4.5v15" />
          <path d="m6.9 10.4-1.6 1.6 1.6 1.6" />
        </>
      )
    case 'expand':
      return (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M10 4.5v15" />
          <path d="m5.3 10.4 1.6 1.6-1.6 1.6" />
        </>
      )
    case 'chevronRight':
      return <path d="m9.5 6 6 6-6 6" />
    case 'chevronDown':
      return <path d="m6 9.5 6 6 6-6" />
    case 'arrowRight':
      return <path d="M4.5 12h15M14 6.5l5.5 5.5L14 17.5" />
    case 'arrowLeft':
      return <path d="M19.5 12h-15M10 6.5 4.5 12 10 17.5" />
    case 'refresh':
      return (
        <>
          <path d="M20 12a8 8 0 1 1-2.5-5.8" />
          <path d="M20 4.5V10h-5.5" />
        </>
      )
    // Seal: a foil badge stamp with a scalloped edge.
    case 'seal':
      return (
        <>
          <path
            d="m12 3 2.1 1.6 2.6-.4 1 2.5 2.3 1.3-.5 2.6 1.5 2.2-1.9 1.8-.2 2.6-2.6.5-1.6 2.1-2.4-1-2.4 1-1.6-2.1-2.6-.5-.2-2.6L3.6 14l1.5-2.2-.5-2.6 2.3-1.3 1-2.5 2.6.4Z"
            fill={filled ? 'currentColor' : 'none'}
          />
          {!filled && <path d="m9.5 12 1.8 1.8 3.4-3.6" />}
        </>
      )
    case 'target':
      return (
        <>
          <circle cx="12" cy="12" r="8.2" />
          <circle cx="12" cy="12" r="4.4" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      )
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 7.4V12l3 1.8" />
        </>
      )
    // Sparkle: a four-point foil glint. Used for AI-authored things.
    case 'sparkle':
      return (
        <path
          d="M12 3.5c.9 4.4 2.2 5.7 6.5 6.5-4.3.8-5.6 2.1-6.5 6.5-.9-4.4-2.2-5.7-6.5-6.5 4.3-.8 5.6-2.1 6.5-6.5Z"
          fill={filled ? 'currentColor' : 'none'}
        />
      )
    case 'offline':
      return (
        <>
          <path d="M3.5 4.5 20.5 20" />
          <path d="M5.2 9.4a11 11 0 0 1 3.1-2M15 7.6a11 11 0 0 1 3.8 1.8" />
          <path d="M8.4 13a6.5 6.5 0 0 1 2-1.2M13.6 11.9a6.5 6.5 0 0 1 2 1.1" />
          <path d="M12 17.2h.01" />
        </>
      )
    /* Three dots — the universal "there are more actions here" affordance.
       Filled circles rather than stroked rings: at 14px a stroked circle is
       mostly hole and reads as three tiny o's. */
    case 'more':
      return (
        <>
          <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </>
      )
    /* Pushpin, drawn head-on and tilted — the shape people actually picture.
       `seal` was standing in for this, which is a rosette: right for a badge
       you earned, wrong for a thing you stuck to the top of a list. */
    /* Editor block shapes. Each one draws the thing it makes, so the button
       is legible without a tooltip — the row previously used `••`, `1.`, a
       tick and a page glyph, three of which are not pictures of anything. */
    case 'listBullet':
      return (
        <>
          <circle cx="5" cy="7" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="5" cy="17" r="1.5" fill="currentColor" stroke="none" />
          <path d="M9.5 7h10M9.5 12h10M9.5 17h10" />
        </>
      )
    case 'listOrdered':
      return (
        <>
          <path d="M9.5 7h10M9.5 12h10M9.5 17h10" />
          <path d="M3.4 5.6 4.8 5v3.4M3.3 15.2a1.2 1.2 0 1 1 2 .85L3.3 18.4h2.2" />
        </>
      )
    case 'listTodo':
      return (
        <>
          <rect x="3.2" y="4.6" width="5" height="5" rx="1.2" />
          <path d="m4.4 7.1 1.1 1.1 1.9-2" />
          <rect x="3.2" y="14.4" width="5" height="5" rx="1.2" />
          <path d="M11 7h9M11 17h9" />
        </>
      )
    /* Quote: the mark itself, not a page with lines on it. */
    case 'quote':
      return (
        <>
          <path d="M9.5 6.5C7 7.6 5.5 9.7 5.5 12.4v5.1h5.2v-5.1H8.1c0-1.9.6-3.2 2.2-4.1Z" fill={filled ? 'currentColor' : 'none'} />
          <path d="M18 6.5c-2.5 1.1-4 3.2-4 5.9v5.1h5.2v-5.1h-2.6c0-1.9.6-3.2 2.2-4.1Z" fill={filled ? 'currentColor' : 'none'} />
        </>
      )
    /* Code: angle brackets, which is what everyone already reads as code. */
    case 'code':
      return (
        <>
          <path d="m8.5 8.5-4 3.5 4 3.5" />
          <path d="m15.5 8.5 4 3.5-4 3.5" />
        </>
      )
    // Table: a ruled grid — the frame plus one row line and one column line,
    // which is the minimum that still reads as rows-and-columns rather than
    // as a plain rectangle (a single card/document outline, already used
    // elsewhere for `note`/`doc`/`deck`).
    case 'table':
      return (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.6" />
          <path d="M3.5 10.2h17M9.8 4.5v15" />
        </>
      )
    /* Thumbs.
       Redrawn simpler: the first version packed a cuff, a curled fist and a
       tapered arm into 24px, and at the 13px these actually render it
       collapsed into a smudge. This is two shapes — a squared-off cuff and a
       plain paddle for the hand — which stays legible small, which is the
       only size it is ever used at. */
    case 'thumbUp':
      return (
        <>
          <rect x="2.8" y="10" width="4.4" height="9.5" rx="1" fill={filled ? 'currentColor' : 'none'} />
          <path
            d="M7.2 10.6 11 3.4a1.9 1.9 0 0 1 3.5 1.4l-1 4.2h4.9a2 2 0 0 1 1.95 2.5l-1.4 5.9a2 2 0 0 1-1.95 1.5H7.2Z"
            fill={filled ? 'currentColor' : 'none'}
          />
        </>
      )
    case 'thumbDown':
      return (
        <>
          <rect x="2.8" y="4.5" width="4.4" height="9.5" rx="1" fill={filled ? 'currentColor' : 'none'} />
          <path
            d="M7.2 13.4 11 20.6a1.9 1.9 0 0 0 3.5-1.4l-1-4.2h4.9a2 2 0 0 0 1.95-2.5l-1.4-5.9A2 2 0 0 0 17 5.1H7.2Z"
            fill={filled ? 'currentColor' : 'none'}
          />
        </>
      )
    case 'pin':
      return (
        <>
          <path
            d="M14.5 3.2 20.8 9.5l-2.3.6a3 3 0 0 0-1.6 1l-2.6 3.2.9.9a1 1 0 0 1 0 1.4l-.5.5-6.4-6.4.5-.5a1 1 0 0 1 1.4 0l.9.9 3.2-2.6a3 3 0 0 0 1-1.6Z"
            fill={filled ? 'currentColor' : 'none'}
          />
          <path d="m8.3 15.7-4.1 4.1" />
        </>
      )
    case 'pencil':
      return (
        <>
          <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
          <path d="M14.5 6.5 17.5 9.5" />
        </>
      )
    case 'userEdit':
      // A person (small, top-left) plus a pencil (bottom-right) — for marks
      // that specifically mean "a human edited this", not just "editable".
      // A bare pencil reads as the second; this is unambiguous at a glance.
      return (
        <>
          <circle cx="8" cy="7.3" r="3" />
          <path d="M3.3 18.2a5 5 0 0 1 9.4-2.2" />
          <path d="M13.3 20.6h3.1L22.7 14a1.7 1.7 0 0 0-2.4-2.4l-6.3 6.3Z" />
          <path d="M18.5 12.4 20.6 14.5" />
        </>
      )
    case 'help':
      return (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M9.5 9.6a2.6 2.6 0 1 1 3.7 2.35c-.85.45-1.2 1-1.2 1.85" />
          <path d="M12 16.9h.01" />
        </>
      )
    case 'alert':
      return (
        <>
          <path d="M12 4.8 3.8 19a.6.6 0 0 0 .5.9h15.4a.6.6 0 0 0 .5-.9Z" />
          <path d="M12 10v4" />
          <path d="M12 17.2h.01" />
        </>
      )
    // ── Subject glyphs — what a subject is about, at a glance (see
    //    lib/subjectIcon.ts). Same family: 24px grid, 1.6 stroke.
    case 'sigma':
      return <path d="M17 5.5H7.2l5.3 6.5-5.3 6.5H17" />
    case 'atom':
      return (
        <>
          <circle cx="12" cy="12" r="1.3" fill="currentColor" />
          <ellipse cx="12" cy="12" rx="8.6" ry="3.4" />
          <ellipse cx="12" cy="12" rx="8.6" ry="3.4" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="8.6" ry="3.4" transform="rotate(-60 12 12)" />
        </>
      )
    case 'flask':
      return (
        <>
          <path d="M9.5 3.5h5" />
          <path d="M10.5 3.5v5.2l-5.2 9.1a1.8 1.8 0 0 0 1.6 2.7h10.2a1.8 1.8 0 0 0 1.6-2.7l-5.2-9.1V3.5" />
          <path d="M7.7 14h8.6" />
        </>
      )
    case 'leaf':
      return (
        <>
          <path d="M19.5 4.5C10.5 4.5 5 9.5 5 16.5c0 1.1.2 2.1.5 3 8 0 14-4.5 14-15Z" />
          <path d="M5.5 19.5 13.5 11.5" />
        </>
      )
    case 'pulse':
      return <path d="M3.5 12.5h4l2-5.5 4 11 2-5.5h5" />
    case 'globe':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <path d="M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" />
        </>
      )
    case 'landmark':
      return (
        <>
          <path d="M4 9 12 4.5 20 9Z" />
          <path d="M6.5 9.5v7.5M10 9.5v7.5M14 9.5v7.5M17.5 9.5v7.5" />
          <path d="M4.5 17.5h15M3.5 20.5h17" />
        </>
      )
    case 'scale':
      return (
        <>
          <path d="M12 4v16M8 20h8M5 7h14" />
          <path d="M2.5 13 5 7l2.5 6a2.5 2.5 0 0 1-5 0Z" />
          <path d="M16.5 13 19 7l2.5 6a2.5 2.5 0 0 1-5 0Z" />
        </>
      )
    case 'book':
      return (
        <>
          <path d="M3.5 5.5c3-1.1 5.9-.9 8.5 1v13c-2.6-1.9-5.5-2.1-8.5-1Z" />
          <path d="M20.5 5.5c-3-1.1-5.9-.9-8.5 1v13c2.6-1.9 5.5-2.1 8.5-1Z" />
        </>
      )
    case 'language':
      return (
        <>
          <path d="M3.5 6h8M7.5 4v2" />
          <path d="M5 6c.6 3 2.5 5.4 5.5 7" />
          <path d="M10 6c-.6 3.4-2.7 6-6 7.5" />
          <path d="m12.5 20.5 3.5-8.5 3.5 8.5M13.7 17.6h4.6" />
        </>
      )
    case 'chart':
      return (
        <>
          <path d="M4 20h16" />
          <path d="M7 16.5v-4M12 16.5V7M17 16.5v-6.5" />
        </>
      )
    case 'music':
      return (
        <>
          <path d="M9 17.5V5.5l10-2v12" />
          <circle cx="6.5" cy="17.5" r="2.5" />
          <circle cx="16.5" cy="15.5" r="2.5" />
        </>
      )
    case 'palette':
      return (
        <>
          <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.1 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-1 .8-1.6 1.8-1.6h2.2a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.2-8.5-7.2Z" />
          <circle cx="7.6" cy="11.2" r="1" fill="currentColor" />
          <circle cx="10" cy="7.4" r="1" fill="currentColor" />
          <circle cx="14.6" cy="7.6" r="1" fill="currentColor" />
        </>
      )
    case 'brain':
      return (
        <>
          <path d="M12 6.2a3 3 0 0 0-5.5-.7 3 3 0 0 0-2 4.9 3.2 3.2 0 0 0 1.3 5.1A3 3 0 0 0 12 18Z" />
          <path d="M12 6.2a3 3 0 0 1 5.5-.7 3 3 0 0 1 2 4.9 3.2 3.2 0 0 1-1.3 5.1A3 3 0 0 1 12 18Z" />
          <path d="M12 6.2V20" />
        </>
      )
    case 'cpu':
      return (
        <>
          <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
          <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" />
          <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
        </>
      )
    case 'bolt':
      return <path d="M13 3.5 5.5 13.5h6l-1 7 7.5-10h-6Z" fill={filled ? 'currentColor' : 'none'} />
    // ── Trust pages (what is stored, who sees it, write to us) and the
    //    landing page's feature marks. Same family: 24px grid, 1.6 stroke.
    case 'database':
      return (
        <>
          <ellipse cx="12" cy="6.2" rx="7" ry="2.7" fill={filled ? 'currentColor' : 'none'} />
          <path d="M5 6.2v11.6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6.2" />
          <path d="M5 12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7" />
        </>
      )
    case 'eye':
      return (
        <>
          <path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z" />
          <circle cx="12" cy="12" r="2.8" fill={filled ? 'currentColor' : 'none'} />
        </>
      )
    case 'mail':
      return (
        <>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <path d="m4.3 7.2 7.7 5.9 7.7-5.9" />
        </>
      )
    // A page with one line lit and a ribbon marking it: "it names its page".
    case 'citePage':
      return (
        <>
          <path d="M13.5 3.5h-7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8" />
          <path d="M14.5 2.8h4v8.4l-2-1.6-2 1.6Z" fill={filled ? 'currentColor' : 'none'} />
          <path d="M8.5 8.5h3.5M8.5 17.5h6" />
          <rect x="8" y="12" width="7.6" height="2.6" rx="1.3" fill="currentColor" stroke="none" />
        </>
      )
    // One source branching into three things: a chat becoming note, deck, quiz.
    case 'fanOut':
      return (
        <>
          <circle cx="4.8" cy="12" r="1.9" fill="currentColor" stroke="none" />
          <path d="M6.7 12h3.6M10.3 12c2.3 0 2.4-5.3 5.2-5.3M10.3 12c2.3 0 2.4 5.3 5.2 5.3M10.3 12h5.2" />
          <rect x="15.8" y="4.7" width="4.7" height="4" rx="1" />
          <rect x="15.8" y="10" width="4.7" height="4" rx="1" fill={filled ? 'currentColor' : 'none'} />
          <rect x="15.8" y="15.3" width="4.7" height="4" rx="1" />
        </>
      )
    case 'mortarboard':
      return (
        <>
          <path d="M2.5 9.5 12 5l9.5 4.5L12 14Z" fill={filled ? 'currentColor' : 'none'} />
          <path d="M6.5 11.6v4.1c0 1.3 2.5 2.8 5.5 2.8s5.5-1.5 5.5-2.8v-4.1" />
          <path d="M21.5 9.5v5" />
        </>
      )
  }
}
