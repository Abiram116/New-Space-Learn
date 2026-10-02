/**
 * The facts the trust pages state about the people behind Space Learn.
 *
 * PLACEHOLDERS — replace every value marked below before deploying. The pages
 * are public and should say who you really are. A missing photo shows
 * initials; a missing form link falls back to email.
 */

export type TeamMember = {
  name: string
  /** Where people write to this person — shown on Contact, used for replies. */
  email: string
  /** Square image under `public/team/`, e.g. `/team/nandhitha.webp`. Initials show without one. */
  photo?: string
  /** Optional profile link (GitHub, LinkedIn, a site). */
  link?: string
}

// PLACEHOLDER: the two people who build Space Learn — names and emails.
export const TEAM: TeamMember[] = [
  { name: 'Abiram Mandava', email: 'sreeabirammandava@gmail.com' },
  { name: 'Nandhitha Yedugani', email: 'ys.nandhitha@gmail.com' },
]

/** Every address at once — "write to either of us" links go to both. */
export const TEAM_EMAILS = TEAM.map((p) => p.email).join(',')

// PLACEHOLDER: a Tally / Google Form URL. Empty means "send feedback by email".
export const FEEDBACK_FORM_URL = ''

export const SOURCE_URL = 'https://github.com/Abiram116/New-Space-Learn'
