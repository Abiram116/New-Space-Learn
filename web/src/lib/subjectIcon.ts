import type { IconName } from '../components/ui/Icon'

/**
 * A subject's icon, read off its name.
 *
 * Subjects have a name and a tone and nothing else (there is no icon column),
 * so the glyph is derived: "Organic Chemistry" gets a flask, "Linear Algebra" a
 * sigma, "Reinforcement Learning" a chip. A name that matches nothing gets a
 * book — every subject is something you read, so the default is never wrong,
 * only less specific.
 *
 * Deterministic and pure on purpose: the same name draws the same icon in the
 * rail, on Home and on a phone, with no request and no stored choice to drift.
 * Rules are tried in order, so the specific ones (biochemistry is chemistry,
 * machine learning is computing) sit above the broad ones that would also match.
 */

type Rule = [IconName, RegExp]

// `\b` before each stem so "art" never matches inside "artificial", and short
// abbreviations (cs, ai, ml, os) are whole words only.
const RULES: Rule[] = [
  // Specific before broad: language models and learning are computing, but
  // "NLP" and "Deep Learning" should not wear the same chip as "Databases".
  ['language', /\b(nlp|natural language|computational linguistics)\b/],
  ['brain', /\b(deep learning|neural|cnns?|rnns?|transformers?)\b/],
  ['code', /\b(programming|coding|code|python|java|javascript|typescript|c\+\+|golang|rust|web dev|frontend|backend|fsd|full ?stack|mern|mean stack)/],
  [
    'cpu',
    /\b(cs|ai|ml|dl|nlp|dsa|os|dbms|cn|coa|iot)\b|\b(computer|computing|computation|artificial intelligence|machine learning|deep learning|reinforcement|neural|algorithm|data structure|database|operating system|software|cyber|network|cloud|compiler|robotics|informatics)/,
  ],
  ['flask', /(chem)|\b(pharma)/],
  ['pulse', /\b(medic|anatomy|physiology|nursing|health|pathology|clinical|surgery|dental|mbbs|neet|pharmacology|immunology)/],
  ['leaf', /\b(bio|botany|zoology|ecology|genetic|cell|microbio|evolution|plant|life science)/],
  ['atom', /\b(physic|quantum|mechanics|thermo|electromag|optics|astro|relativity|nuclear)/],
  ['chart', /econom|\b(statistic|stats|probability|data science|analytics|econ|finance|accounting|business|marketing|management|commerce|investing)|\bmba\b/],
  [
    'sigma',
    /\b(math|maths|calculus|algebra|geometry|trigonometry|arithmetic|discrete|number theory|differential|integral|matrices|matrix|topology|jee)/,
  ],
  ['bolt', /\b(electric|electronic|circuit|engineering|mechanical|civil|signal|embedded|vlsi|power system)/],
  ['brain', /\b(psych|neuro|cognitive|philosoph|sociology|behavio|mind)/],
  ['scale', /\b(law|legal|ethics|justice|constitution|jurisprud)/],
  ['landmark', /\b(history|histories|civics|politic|government|polity|archaeolog|classics|upsc|ancient|medieval)/],
  ['globe', /\b(geograph|geolog|earth|environment|climate|ocean|world)/],
  [
    'language',
    /\b(language|linguistic|grammar|vocab|french|spanish|german|japanese|chinese|mandarin|korean|hindi|tamil|telugu|kannada|malayalam|sanskrit|arabic|latin|italian|russian|ielts|toefl)/,
  ],
  ['book', /\b(literature|english|poetry|novel|writing|reading|essay|journalism)/],
  ['music', /\b(music|piano|guitar|harmony|composition|singing)/],
  ['palette', /\b(art|arts|design|drawing|painting|architecture|photography|film|animation|ux|ui)\b/],
]

export const DEFAULT_SUBJECT_ICON: IconName = 'book'

/** The icon a name earns, or null when no rule knows it. */
export function matchedSubjectIcon(name: string | null | undefined): IconName | null {
  const text = (name ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim()
  if (!text) return null
  for (const [icon, re] of RULES) if (re.test(text)) return icon
  return null
}

export function subjectIcon(name: string | null | undefined): IconName {
  return matchedSubjectIcon(name) ?? DEFAULT_SUBJECT_ICON
}

/** First letter for a name no rule knows: tells "Zoning Law" from "Quilting" where a generic book cannot. */
export function subjectMonogram(name: string | null | undefined): string {
  const m = /[\p{L}\p{N}]/u.exec((name ?? '').trim())
  return m ? m[0].toUpperCase() : ''
}
