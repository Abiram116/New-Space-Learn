/**
 * The facts the trust pages state about the people behind Space Learn.
 *
 * The pages are public and should say who you really are. A missing photo
 * shows initials.
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

// The two people who build Space Learn.
export const TEAM: TeamMember[] = [
  { name: 'Abiram Mandava', email: 'sreeabirammandava@gmail.com' },
  { name: 'Nandhitha Yedugani', email: 'ys.nandhitha@gmail.com' },
]

/** Every address at once — "write to either of us" links go to both. */
export const TEAM_EMAILS = TEAM.map((p) => p.email).join(',')

export const SOURCE_URL = 'https://github.com/Abiram116/New-Space-Learn'
