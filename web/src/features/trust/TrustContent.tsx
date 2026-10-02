/**
 * What the trust pages say, as data: an optional meta line, an intro, and
 * sections. Two surfaces read it — the slide-over inside the app and the
 * full-screen sheet from the landing page — so the words exist once.
 *
 * Every claim should stay true of the code. The Privacy and Terms wording is a
 * draft written from how the app works, not legal advice; have it read before
 * relying on it.
 */

import { useState, type ReactNode } from 'react'
import { FEEDBACK_FORM_URL, SOURCE_URL, TEAM, TEAM_EMAILS, type TeamMember } from './config'
import { TRUST_UPDATED, TRUST_VERSION, type TrustSlug } from './pages'

export type TrustSection = {
  id: string
  title: string
  body: ReactNode
  /** Spans the full width of a multi-column layout (the team row). */
  wide?: boolean
}
export type TrustDoc = {
  /** "Effective … · version …" for the formal pages. */
  meta?: string
  intro: ReactNode
  sections: TrustSection[]
  /** A column beside the page on wide screens (About: the two of us). */
  aside?: { title: string; body: ReactNode }
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[14.5px] leading-[1.7] text-ink-2 first:mt-0">{children}</p>
}
function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-2 text-[14.5px] leading-[1.65] text-ink-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-brand" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
const strong = (t: string) => <strong className="font-semibold text-ink">{t}</strong>
const linkCls = 'font-medium text-brand-deep underline decoration-brand/40 underline-offset-[3px] transition-colors hover:decoration-brand'
/** "Write to either of us" — one mailto addressed to both. */
function Mail({ children }: { children?: ReactNode }) {
  return (
    <a href={`mailto:${TEAM_EMAILS}`} className={linkCls}>
      {children ?? 'either of us'}
    </a>
  )
}
/** A big, quiet call to action — the email address, or the feedback form. */
export function ActionRow({ href, label, hint, external }: { href: string; label: string; hint: string; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group mt-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-well px-5 py-4 transition-colors hover:border-brand/50 hover:bg-brand/10"
    >
      <span className="min-w-0 truncate text-[16px] font-semibold text-ink">{label}</span>
      <span className="setcode shrink-0 text-brand-deep transition-transform duration-200 group-hover:translate-x-0.5">
        {hint} →
      </span>
    </a>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/** A portrait and a name: the two people behind Space Learn. */
function Member({ person }: { person: TeamMember }) {
  const body = (
    <>
      <span className="grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-2xl border border-white/[0.08] bg-[radial-gradient(circle_at_70%_20%,rgba(255,107,69,0.32),transparent_65%)]">
        {person.photo ? (
          <img src={person.photo} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span className="nameplate text-[34px] text-brand-deep">{initials(person.name)}</span>
        )}
      </span>
      <span className="mt-3 block truncate text-[15px] font-semibold text-ink">{person.name}</span>
    </>
  )
  return person.link ? (
    <a href={person.link} target="_blank" rel="noopener noreferrer" className="block min-w-0 transition-opacity hover:opacity-80">
      {body}
    </a>
  ) : (
    <div className="min-w-0">{body}</div>
  )
}

/** One person's address: write to them, or copy it. */
function PersonContact({ person }: { person: TeamMember }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(person.email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard (an insecure origin, an old browser): the address is on screen to select.
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
      <div className="min-w-0">
        <p className="truncate text-[16px] font-semibold text-ink">{person.name}</p>
        <p className="mt-0.5 truncate text-[14.5px] text-ink-2">{person.email}</p>
      </div>
      <div className="flex gap-2">
        <a
          href={`mailto:${person.email}`}
          className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-[13.5px] font-bold text-[#1a120f] transition-opacity hover:opacity-90"
        >
          Write
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-9 cursor-pointer items-center rounded-full bg-white/[0.07] px-4 text-[13.5px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.12] hover:text-ink"
        >
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  )
}

const FORMAL_META = `Effective ${TRUST_UPDATED} · Version ${TRUST_VERSION}`

export const TRUST_DOCS: Record<TrustSlug, TrustDoc> = {
  about: {
    intro: (
      <P>
        Space Learn is a study app built around your own material. You bring the PDFs and notes for a
        subject you&rsquo;re behind on; it answers from them, shows the page each answer came from, and
        turns what you read into notes, flashcards and quizzes that come back right before you forget.
      </P>
    ),
    sections: [
      {
        id: 'why',
        title: 'Why it exists',
        body: (
          <P>
            General chatbots answer from the whole internet, confidently, and you can&rsquo;t tell which
            part is right for your course. We wanted answers you can check against the material
            you&rsquo;ll be tested on, and a revision schedule that does the remembering for you.
          </P>
        ),
      },
      {
        id: 'how',
        title: 'How it works',
        body: (
          <List
            items={[
              <>{strong('Upload')} a source to a topic. It is split into passages and indexed.</>,
              <>{strong('Ask')} a question. The answer is written from the passages that match, with numbered citations.</>,
              <>{strong('Keep')} what matters as notes, cards or a quiz. Cards are scheduled with FSRS, a spaced-repetition method.</>,
            ]}
          />
        ),
      },
      {
        id: 'open-source',
        title: 'Open source',
        body: (
          <P>
            Space Learn is released under the MIT licence.{' '}
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Read the code on GitHub
            </a>
            .
          </P>
        ),
      },
    ],
    aside: {
      title: 'The two of us',
      body: (
        <div className="grid grid-cols-2 gap-4">
          {TEAM.map((person, i) => (
            <Member key={`${person.name}-${i}`} person={person} />
          ))}
        </div>
      ),
    },
  },

  privacy: {
    meta: FORMAL_META,
    intro: (
      <P>
        The short version: we keep what you put in so the app can work, we use a small number of
        services to run it, and we never sell your data or show you ads.
      </P>
    ),
    sections: [
      {
        id: 'what-we-store',
        title: 'What we store',
        body: (
          <List
            items={[
              <>{strong('Your account')}: email, name, and your profile picture if you sign in with Google.</>,
              <>{strong('What you create')}: subjects, topics, uploaded files, notes, flashcards, quizzes and chat messages.</>,
              <>{strong('How you study')}: card grades, quiz scores, daily activity, and the preferences the app learns about how you like answers.</>,
            ]}
          />
        ),
      },
      {
        id: 'processors',
        title: 'Who processes it',
        body: (
          <List
            items={[
              <>{strong('Supabase')} stores your account, your data and your files.</>,
              <>{strong('Groq')} generates answers. Your question and the matching passages from your sources are sent to it for each answer.</>,
              <>{strong('Vercel')} hosts the website and {strong('Render')} hosts the server.</>,
              <>{strong('Google')}, only if you choose &ldquo;Continue with Google&rdquo;, to confirm who you are.</>,
            ]}
          />
        ),
      },
      {
        id: 'never',
        title: 'What we never do',
        body: (
          <List
            items={[
              'Sell or rent your data, or share it for advertising.',
              'Use analytics or ad trackers.',
              'Show your material to other users.',
            ]}
          />
        ),
      },
      {
        id: 'browser',
        title: 'In your browser',
        body: (
          <P>
            Your sign-in session is kept in your browser&rsquo;s local storage, with a few display
            preferences (a collapsed sidebar, dismissed tips). There are no tracking cookies.
          </P>
        ),
      },
      {
        id: 'deleting',
        title: 'Deleting things',
        body: (
          <P>
            Deleting a topic, a subject or your whole account deletes what was in it, including the files
            you uploaded. You can delete your account from Settings › Privacy, or write to <Mail /> and we
            will do it for you.
          </P>
        ),
      },
      {
        id: 'questions',
        title: 'Questions',
        body: (
          <P>
            Write to <Mail />. If this policy changes, the date and version above change with it.
          </P>
        ),
      },
    ],
  },

  terms: {
    meta: FORMAL_META,
    intro: <P>By using Space Learn you agree to these terms.</P>,
    sections: [
      {
        id: 'your-material',
        title: 'Your material',
        body: (
          <P>
            What you upload and write stays yours. You give us permission to store and process it only to
            run the app for you. Only upload material you have the right to use.
          </P>
        ),
      },
      {
        id: 'ai',
        title: 'AI answers can be wrong',
        body: (
          <P>
            Answers, notes, cards and quizzes are generated by a language model. They cite your sources so
            you can check them, but they can still be wrong or incomplete. Check anything that matters
            against your material before you rely on it.
          </P>
        ),
      },
      {
        id: 'fair-use',
        title: 'Fair use',
        body: (
          <List
            items={[
              "Don't use Space Learn to break the law or someone else's rights.",
              "Don't try to break, overload or get around the service's limits.",
              "Don't use it to access anyone else's data.",
            ]}
          />
        ),
      },
      {
        id: 'service',
        title: 'The service',
        body: (
          <P>
            Space Learn runs on free and low-cost infrastructure and is provided as is, without guarantees
            of availability. Limits on uploads and usage may change. We may suspend accounts that break
            these terms.
          </P>
        ),
      },
      {
        id: 'code',
        title: 'The code',
        body: <P>The source code is released under the MIT licence. These terms cover the hosted service.</P>,
      },
      {
        id: 'changes',
        title: 'Changes',
        body: (
          <P>
            If these terms change, the date and version above change with them. Questions go to <Mail />.
          </P>
        ),
      },
    ],
  },

  contact: {
    intro: <P>Space Learn is built by two people. Write to either of us — whoever sees it first replies.</P>,
    sections: [
      {
        id: 'email',
        title: 'Write to us',
        wide: true,
        body: (
          <div className="mt-1 grid gap-4 sm:grid-cols-2">
            {TEAM.map((person, i) => (
              <PersonContact key={`${person.email}-${i}`} person={person} />
            ))}
          </div>
        ),
      },
      {
        id: 'help-us-help',
        title: 'Help us help you',
        body: (
          <P>
            For something about your data or your account, say which email you sign in with. For a bug, a
            screenshot and what you clicked just before it help most.
          </P>
        ),
      },
    ],
  },

  feedback: {
    intro: (
      <P>
        What worked, what got in the way, what you wished it did. Every message is read by both of us.
      </P>
    ),
    sections: [
      {
        id: 'send',
        title: FEEDBACK_FORM_URL ? 'The form' : 'By email',
        body: FEEDBACK_FORM_URL ? (
          <ActionRow href={FEEDBACK_FORM_URL} label="Open the feedback form" hint="Two minutes" external />
        ) : (
          <ActionRow
            href={`mailto:${TEAM_EMAILS}?subject=${encodeURIComponent('Space Learn feedback')}`}
            label="Send feedback by email"
            hint="Write"
          />
        ),
      },
    ],
  },
}
