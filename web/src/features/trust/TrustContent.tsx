/**
 * What the trust pages say, as data. Two surfaces read it — the slide-over
 * inside the app and the full-screen card from the landing page — and both
 * hand it to `TrustArticle`, so the words and their order exist once.
 *
 * Every page is built the same way, so a reader always knows where to look:
 *
 *   1. `summary` — the short version, one or two sentences. If you read
 *      nothing else, read this.
 *   2. `facts`   — the few things people actually come to a policy for (what
 *      is stored, who sees it, how to delete it, who to ask), as tiles.
 *   3. `sections` — the full text, in the order you would ask the questions.
 *      Long pages get a "On this page" list to jump around.
 *
 * Every claim should stay true of the code. The Privacy and Terms wording is a
 * draft written from how the app works, not legal advice; have it read before
 * relying on it.
 */

import type { ReactNode } from 'react'
import type { IconName } from '../../components/ui/Icon'
import { FeedbackForm } from '../feedback/FeedbackForm'
import { SOURCE_URL, TEAM, TEAM_EMAILS, type TeamMember } from './config'
import { PersonContact } from './PersonContact'
import { TRUST_UPDATED, TRUST_VERSION, type TrustSlug } from './pages'

export type TrustSection = {
  id: string
  title: string
  body: ReactNode
}
/** The tones a fact tile can take — the palette's own accents. */
export type FactTone = 'sky' | 'sun' | 'brand' | 'jade'
export type TrustFact = { icon: IconName; tone: FactTone; label: string; body: ReactNode }
export type TrustDoc = {
  /** "Effective … · version …" for the formal pages. */
  meta?: string
  /** The short version: what the page comes down to, in a sentence or two. */
  summary: ReactNode
  /** A line of context under the summary, when the page needs one. */
  intro?: ReactNode
  /** The key facts, highlighted above the full text. */
  facts?: TrustFact[]
  sections: TrustSection[]
  /** A column beside the page on wide screens (About: the two of us). */
  aside?: { title: string; body: ReactNode }
}

/** Pages with at least this many sections get an "On this page" list. */
export const TOC_MIN_SECTIONS = 5

function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 first:mt-0">{children}</p>
}
function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2.5 first:mt-0">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-[0.72em] h-1.5 w-1.5 shrink-0 rounded-full bg-brand/80" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}
const strong = (t: string) => <strong className="font-semibold text-ink">{t}</strong>
export const trustLinkCls =
  'font-medium text-brand-deep underline decoration-brand/40 underline-offset-[3px] transition-colors hover:decoration-brand'
/** "Write to either of us" — one mailto addressed to both. */
function Mail({ children }: { children?: ReactNode }) {
  return (
    <a href={`mailto:${TEAM_EMAILS}`} className={trustLinkCls}>
      {children ?? 'either of us'}
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
    <a href={person.link} target="_blank" rel="noopener noreferrer" className="block min-w-0 rounded-2xl transition-opacity hover:opacity-80">
      {body}
    </a>
  ) : (
    <div className="min-w-0">{body}</div>
  )
}

const FORMAL_META = `Effective ${TRUST_UPDATED} · Version ${TRUST_VERSION}`

export const TRUST_DOCS: Record<TrustSlug, TrustDoc> = {
  about: {
    summary: (
      <>
        Space Learn turns the material you already have — lecture slides, PDFs, notes, past papers —
        into a tutor that answers from it, cites the page it used, and helps you remember it until the
        exam.
      </>
    ),
    sections: [
      {
        id: 'why',
        title: 'Why we built it',
        body: (
          <>
            <P>
              Most AI tools answer from the whole internet. The answer sounds sure of itself, but you
              can&rsquo;t tell whether it matches what your course actually teaches — and in an exam,
              your course is what counts.
            </P>
            <P>
              So Space Learn answers from what you give it and shows you exactly where each answer came
              from. You choose in Settings whether it may also draw on general knowledge, or stick strictly
              to your material.
            </P>
          </>
        ),
      },
      {
        id: 'how',
        title: 'How it works',
        body: (
          <List
            items={[
              <>{strong('Add your material')} to a topic — PDF, CSV, text, Markdown or a photo of your notes, up to 20 MB each.</>,
              <>{strong('Ask anything.')} Each answer is written from the passages that match, with numbered citations you can open.</>,
              <>{strong('Keep what matters')} as a note, a deck of flashcards or a quiz, in one click.</>,
              <>{strong('Review at the right time.')} Cards come back just before you would forget them (spaced repetition, FSRS).</>,
            ]}
          />
        ),
      },
      {
        id: 'learns-you',
        title: 'It learns how you study',
        body: (
          <P>
            Your quiz results, card grades and the feedback you give on answers shape how it explains
            things and what it asks you next. You can see and reset what it has learned at any time in
            Settings.
          </P>
        ),
      },
      {
        id: 'open-source',
        title: 'Open source',
        body: (
          <P>
            The code is public under the MIT licence, so anyone can check how it works.{' '}
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={trustLinkCls}>
              Read it on GitHub
            </a>
            .
          </P>
        ),
      },
    ],
    aside: {
      title: 'Built by',
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
    summary: (
      <>
        We use your data only to run Space Learn for you. We never sell it, and you can delete your
        account and the data in it whenever you want.
      </>
    ),
    intro: (
      <P>
        Your study material is personal. This page explains, in plain words, what we keep, why, who
        helps us run the service, and how you stay in control.
      </P>
    ),
    facts: [
      {
        icon: 'database',
        tone: 'sky',
        label: 'What we store',
        body: 'Your account, the files you upload and everything made from them, and how you study.',
      },
      {
        icon: 'eye',
        tone: 'sun',
        label: 'Who can see it',
        body: 'Not other users — each record is locked to your account. Our AI provider sees only what it needs to answer, and never trains on it.',
      },
      {
        icon: 'trash',
        tone: 'brand',
        label: 'How to delete it',
        body: 'Delete any file, note or deck whenever you like, or your whole account in Settings — your data goes with it.',
      },
      {
        icon: 'mail',
        tone: 'jade',
        label: 'Questions or a copy',
        body: (
          <>
            Write to <Mail /> — we&rsquo;ll send you a copy of your data or help you delete it.
          </>
        ),
      },
    ],
    sections: [
      {
        id: 'what-we-collect',
        title: 'What we collect',
        body: (
          <List
            items={[
              <>{strong('Your account')} — your email address and name, plus the profile picture your Google account supplies if you sign in with Google (held by our sign-in provider).</>,
              <>{strong('Your material')} — the files you upload, the text we extract from them, and the numeric search index (embeddings) we build from that text.</>,
              <>{strong('What you create')} — subjects, topics, chats (with a short running summary of earlier conversation that helps it keep context), notes, flashcards, quizzes and your answers.</>,
              <>{strong('How you study')} — card grades, quiz scores, daily activity, settings, and the thumbs-up or thumbs-down feedback you give on answers.</>,
              <>{strong('Feedback you send')} — your answers to the feedback form, and your email if you add one as a visitor. We also record the page you sent it from and your browser&rsquo;s user-agent text. It is linked to your account when you are signed in, and deleted with it.</>,
              <>{strong('Technical logs')} — our hosting providers keep standard request logs (such as IP address and time) for security and fixing errors, on their own schedule. We don&rsquo;t keep IP addresses in our database; the server only holds them briefly in memory to limit abuse.</>,
            ]}
          />
        ),
      },
      {
        id: 'how-we-use-it',
        title: 'How we use it',
        body: (
          <List
            items={[
              'To answer your questions from your own material, with citations.',
              'To build your notes, flashcards and quizzes, and schedule your reviews.',
              'To adapt explanations and difficulty to how you learn.',
              'To keep the service secure and fix problems.',
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
              'Sell, rent or trade your data.',
              'Show you ads, or share your data for advertising.',
              'Use analytics, advertising trackers or tracking cookies.',
            ]}
          />
        ),
      },
      {
        id: 'ai',
        title: 'What the AI sees',
        body: (
          <>
            <P>
              PDFs, CSVs and text files are read and indexed on our own server. When you ask a question,
              we send our AI provider ({strong('Groq')}) only what it needs to answer:
            </P>
            <List
              items={[
                'your question and the matching passages from your material;',
                'recent messages and a running summary of that chat;',
                'a short summary of your study preferences.',
              ]}
            />
            <P>
              When you ask it to make notes, flashcards or a quiz, it receives the relevant passages of
              your material. Photos and images you upload are sent to it so their text can be read.
            </P>
            <P>
              We do not train AI models on your material, and we do not share it with other users. What
              we send to Groq is handled under Groq&rsquo;s own terms and privacy policy, which we don&rsquo;t control.
            </P>
          </>
        ),
      },
      {
        id: 'providers',
        title: 'Services that help us run Space Learn',
        body: (
          <List
            items={[
              <>{strong('Supabase')} — sign-in, database and file storage (servers in Seoul, South Korea).</>,
              <>{strong('Groq')} — generates answers, notes, cards and quizzes.</>,
              <>{strong('Vercel')} and {strong('Render')} — host the website and the server (the server runs in Singapore).</>,
              <>{strong('Google')} — only if you choose &ldquo;Continue with Google&rdquo;.</>,
            ]}
          />
        ),
      },
      {
        id: 'browser',
        title: 'Cookies and your browser',
        body: (
          <P>
            We don&rsquo;t use tracking cookies. Your browser stores your sign-in session and a few
            small settings (like a collapsed sidebar, or that you have finished the welcome questions) so
            the app works as you left it.
          </P>
        ),
      },
      {
        id: 'control',
        title: 'Your control',
        body: (
          <List
            items={[
              'Delete any file, note, deck, quiz, topic or subject whenever you like. Deleting a file also removes its stored copy and its extracted text.',
              'Reset what the app has learned about your study style in Settings.',
              'Delete your account in Settings. Your profile, chats, notes, cards, quizzes, study history, feedback and uploaded files are removed with it.',
              <>Ask us for a copy of your data, or for help deleting it, by writing to <Mail />.</>,
            ]}
          />
        ),
      },
      {
        id: 'retention',
        title: 'How long we keep it',
        body: (
          <>
            <P>
              We keep your data while your account is open. When you delete something it is removed from
              our live database straight away, and we delete the stored file at the same time.
            </P>
            <P>
              If the storage service is briefly unavailable that clean-up can fail, so a file may linger
              until we remove it. Copies in our providers&rsquo; routine backups and server logs expire on
              their own schedule.
            </P>
          </>
        ),
      },
      {
        id: 'security',
        title: 'Security',
        body: (
          <P>
            Data travels over encrypted connections, every request is checked against your account, and
            database access rules limit each record to its owner. No system is perfect — if something
            goes wrong that affects your data, we will tell you.
          </P>
        ),
      },
      {
        id: 'changes',
        title: 'Changes to this policy',
        body: (
          <P>
            If we change how we handle your data, we will update this page, its date and its version,
            and make significant changes clear in the app. Questions? Write to <Mail />.
          </P>
        ),
      },
    ],
  },

  terms: {
    meta: FORMAL_META,
    summary: (
      <>
        Use Space Learn to learn, keep your account safe, and check what the AI tells you. What you
        upload stays yours.
      </>
    ),
    intro: (
      <P>
        These terms are the agreement between you and us when you use Space Learn. We have kept them
        short and plain. By creating an account or using the service, you agree to them.
      </P>
    ),
    facts: [
      {
        icon: 'user',
        tone: 'sky',
        label: 'Who can use it',
        body: 'Anyone 13 or older. Under 18, check that a parent or guardian is happy for you to use it.',
      },
      {
        icon: 'seal',
        tone: 'sun',
        label: 'Your content',
        body: 'Stays yours. We store and process it only to run Space Learn for you.',
      },
      {
        icon: 'alert',
        tone: 'brand',
        label: 'AI can be wrong',
        body: 'Answers cite your sources so you can check them — always check anything important.',
      },
      {
        icon: 'check',
        tone: 'jade',
        label: 'Play fair',
        body: "Study honestly, follow your school's rules on AI, and don't misuse the service.",
      },
    ],
    sections: [
      {
        id: 'who-can-use',
        title: 'Who can use Space Learn',
        body: (
          <P>
            You need to be at least 13 years old. If you are under 18, make sure a parent or guardian is
            happy for you to use it. Keep your account details safe — you are responsible for what
            happens on your account.
          </P>
        ),
      },
      {
        id: 'your-content',
        title: 'Your content stays yours',
        body: (
          <>
            <P>
              You own everything you upload and create. You give us permission to store and process it
              only to run Space Learn for you — nothing else.
            </P>
            <P>
              Only upload material you have the right to use, such as your own notes or course material
              you&rsquo;re allowed to study from.
            </P>
          </>
        ),
      },
      {
        id: 'ai',
        title: 'AI can make mistakes',
        body: (
          <P>
            Answers, notes, flashcards and quizzes are generated by AI. They cite your sources so you can
            check them, but they can still be wrong or incomplete. Always check anything important
            against your material — Space Learn is a study aid, not a replacement for your course.
          </P>
        ),
      },
      {
        id: 'honest-study',
        title: 'Study honestly',
        body: (
          <P>
            Use Space Learn to learn, not to cheat. Follow your school&rsquo;s or university&rsquo;s
            rules on AI and academic integrity — submitting AI-written work as your own may break them.
          </P>
        ),
      },
      {
        id: 'fair-use',
        title: 'Fair use',
        body: (
          <List
            items={[
              "Don't use the service for anything illegal or harmful.",
              "Don't upload content that infringes someone else's rights.",
              "Don't try to break, overload or get around the service's limits or security.",
              "Don't try to access anyone else's account or data.",
            ]}
          />
        ),
      },
      {
        id: 'service',
        title: 'The service',
        body: (
          <>
            <P>
              Space Learn is free and runs on modest infrastructure, so it is provided as it is, without
              guarantees that it will always be available or error-free.
            </P>
            <P>
              Upload sizes and usage limits apply and may change. We may change or stop features, and we
              may suspend accounts that break these terms.
            </P>
          </>
        ),
      },
      {
        id: 'liability',
        title: 'Liability',
        body: (
          <P>
            To the extent the law allows, we are not liable for indirect losses, or for decisions you
            make based on the service&rsquo;s output — including exam results.
          </P>
        ),
      },
      {
        id: 'ending',
        title: 'Ending your account',
        body: (
          <P>
            You can stop using Space Learn and delete your account at any time from Settings. If we ever
            shut the service down, we will give notice and time to save what you need.
          </P>
        ),
      },
      {
        id: 'changes',
        title: 'Changes, law and contact',
        body: (
          <>
            <P>
              If these terms change, we will update this page and its date, and make significant changes
              clear in the app. Continuing to use Space Learn means you accept the updated terms.
            </P>
            <P>These terms are governed by the laws of India. Questions? Write to <Mail />.</P>
          </>
        ),
      },
    ],
  },

  contact: {
    summary: (
      <>
        Space Learn is built by two people. Write to either of us about anything — a question, a
        problem, an idea or your data. We read everything and reply as soon as we can.
      </>
    ),
    sections: [
      {
        id: 'email',
        title: 'Write to us',
        body: (
          <div className="mt-1 grid gap-4 sm:grid-cols-2">
            {TEAM.map((person, i) => (
              <PersonContact key={`${person.email}-${i}`} person={person} />
            ))}
          </div>
        ),
      },
      {
        id: 'bugs',
        title: 'Reporting a problem',
        body: (
          <P>
            Tell us what you were doing, what you expected and what happened instead. A screenshot helps
            a lot.
          </P>
        ),
      },
      {
        id: 'account',
        title: 'About your account or data',
        body: (
          <P>
            Write from the email you sign in with, so we can find your account. We will never ask for
            your password.
          </P>
        ),
      },
    ],
  },

  feedback: {
    summary: (
      <>
        Space Learn gets better because of what students tell us. A few quick questions, then room to
        say anything you like. Both of us read every message.
      </>
    ),
    sections: [
      {
        id: 'form',
        title: 'Your feedback',
        body: (
          <div className="mt-2">
            <FeedbackForm source="landing" />
          </div>
        ),
      },
    ],
  },
}
