import { Route, Routes, useLocation } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth } from './auth/guards'
import { AppShell } from './components/layout/AppShell'
import { Home } from './features/home/Home'
import { OnboardingGate } from './features/onboarding/OnboardingGate'
import {
  AdminPage,
  AuthCallback,
  Onboarding,
  ResetPassword,
  SignIn,
  SignUp,
  DocsView,
  FlashcardsView,
  Landing,
  Lazy,
  NotesView,
  Profile,
  QuizzesView,
  Settings,
} from './routes/lazyRoutes'
import { NotFound } from './routes/NotFound'
import { ADMIN_PATH } from './lib/env'
import { RealLocationContext } from './lib/realLocation'
import { TrustLayer, type TrustState } from './features/trust/TrustLayer'
import { TRUST_SLUGS } from './features/trust/pages'
import { TopicCanonical } from './routes/TopicCanonical'
import { RootRoute } from './routes/RootRoute'
import { ChatAliasRoute, SkillsRoute, TopicIndexRoute, TopicSkillsRedirect } from './routes/TopicRoutes'

/** The screens inside a topic. Shared by the current address and the old `/s/` one. */
const topicRoutes = (
  <>
    {/* Chat on desktop; the topic hub on phones, which have no chat. */}
    <Route index element={<TopicIndexRoute />} />
    <Route path="chat" element={<ChatAliasRoute />} />
    <Route
      path="docs"
      element={
        <Lazy>
          <DocsView />
        </Lazy>
      }
    />
    <Route
      path="notes"
      element={
        <Lazy>
          <NotesView />
        </Lazy>
      }
    />
    <Route
      path="flashcards"
      element={
        <Lazy>
          <FlashcardsView />
        </Lazy>
      }
    />
    <Route
      path="quizzes"
      element={
        <Lazy>
          <QuizzesView />
        </Lazy>
      }
    />
    <Route path="skills" element={<TopicSkillsRedirect />} />
  </>
)

export default function App() {
  return (
    <>
      <AppRoutes />
      {/* About / Privacy / Terms / … slide in over any page — see features/trust. */}
      <TrustLayer />
    </>
  )
}

function AppRoutes() {
  // A trust page opened from the landing page carries the page it was opened
  // on; keep rendering THAT here, so the landing page stays mounted (scroll,
  // animation state and all) under the sheet instead of being torn down and
  // rebuilt behind it. See features/trust/TrustLayer.
  const location = useLocation()
  const background = (location.state as TrustState | null)?.background
  return (
    <RealLocationContext.Provider value={location}>
    <Routes location={background ?? location}>
      {/* `/` decides: signed in → the app, signed out → the pitch. */}
      <Route path="/" element={<RootRoute />} />
      {/* Always the pitch, so it stays linkable while signed in. */}
      <Route
        path="/welcome"
        element={
          <Lazy>
            <Landing />
          </Lazy>
        }
      />

      <Route
        path="/signin"
        element={
          <RedirectIfAuthed>
            <Lazy>
              <SignIn />
            </Lazy>
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfAuthed>
            <Lazy>
              <SignUp />
            </Lazy>
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/auth/callback"
        element={
          <Lazy>
            <AuthCallback />
          </Lazy>
        }
      />
      {/* Landed on from a password-reset email, via AuthCallback's `?reset=1`
          branch. Guards its own session (see ResetPassword) rather than
          using RequireAuth — it must not bounce through OnboardingGate. */}
      <Route
        path="/auth/reset-password"
        element={
          <Lazy>
            <ResetPassword />
          </Lazy>
        }
      />

      {/* First run goes here instead of the app. Outside the AppShell on
          purpose: the rail and the dock are furniture for a student who has
          material, and showing an empty one behind the intake undercuts it. */}
      <Route
        path="/welcome-aboard"
        element={
          <RequireAuth>
            <Lazy>
              <Onboarding />
            </Lazy>
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <OnboardingGate>
              <AppShell />
            </OnboardingGate>
          </RequireAuth>
        }
      >
        <Route path="/home" element={<Home />} />
        <Route
          path="/profile"
          element={
            <Lazy>
              <Profile />
            </Lazy>
          }
        />
        <Route
          path="/settings"
          element={
            <Lazy>
              <Settings />
            </Lazy>
          }
        />
        {/* Notes, Cards and Quizzes list everything the student has, so they
            live at their own addresses with no topic in them. The topic they
            create new things in comes from `useTopicScope`. The same screens
            are also reachable under a topic (`/s/<subject>/<topic>/notes`). */}
        <Route
          path="/flashcards"
          element={
            <Lazy>
              <FlashcardsView />
            </Lazy>
          }
        />
        <Route
          path="/quizzes"
          element={
            <Lazy>
              <QuizzesView />
            </Lazy>
          }
        />
        <Route path="/skills" element={<SkillsRoute />} />
        <Route
          path="/notes"
          element={
            <Lazy>
              <NotesView />
            </Lazy>
          }
        />
        {/* A topic's address is `/<subject>/<topic>` — readable slugs, with ids
            accepted too, and `TopicCanonical` rewriting an id, an old `/s/…`
            address or a renamed topic to the current slug. It must match
            `subspacePath()` in `lib/nav.ts`, and a subject can't be named
            like a page (`RESERVED_ROOTS` in `lib/slug.ts`). Fixed pages win
            over this pattern, so `/home` and `/auth/callback` still resolve.
            Keep it at exactly two segments: links elsewhere assume that shape. */}
        <Route path="/:spaceId/:subspaceId" element={<TopicCanonical />}>
          {topicRoutes}
        </Route>
        {/* The old address: forwards to the one above (TopicCanonical). */}
        <Route path="/s/:spaceId/:subspaceId" element={<TopicCanonical />}>
          {topicRoutes}
        </Route>
      </Route>

      {/* The trust pages' own addresses. Opened from the landing page, the
          page underneath is that landing page (see `background` above). On a
          shared link there is none, so the landing page is drawn here for the
          sheet to rise over. Public, signed in or not, and in the sitemap. */}
      {TRUST_SLUGS.map((slug) => (
        <Route
          key={slug}
          path={`/${slug}`}
          element={
            <Lazy>
              <Landing />
            </Lazy>
          }
        />
      ))}

      {/* The feedback desk: linked from nowhere, behind its own password
          rather than an account — see features/admin. */}
      <Route
        path={`/${ADMIN_PATH}`}
        element={
          <Lazy>
            <AdminPage />
          </Lazy>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
    </RealLocationContext.Provider>
  )
}
