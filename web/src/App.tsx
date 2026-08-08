import { Route, Routes } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth } from './auth/guards'
import { AppShell } from './components/layout/AppShell'
import { AuthCallback } from './features/auth/AuthCallback'
import { SignIn } from './features/auth/SignIn'
import { SignUp } from './features/auth/SignUp'
import { Home } from './features/home/Home'
import {
  ChatView,
  DocsView,
  FlashcardsView,
  Landing,
  Lazy,
  NotesView,
  Profile,
  QuizzesView,
  Settings,
  SkillsView,
} from './routes/lazyRoutes'
import { NotFound } from './routes/NotFound'
import { RootRoute } from './routes/RootRoute'

export default function App() {
  return (
    <Routes>
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
            <SignIn />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfAuthed>
            <SignUp />
          </RedirectIfAuthed>
        }
      />
      <Route path="/auth/callback" element={<AuthCallback />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
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
        {/* The `/s/` prefix is REQUIRED and must match `subspacePath()` in
            `lib/nav.ts`, which is the only place subspace URLs are built.

            It was briefly dropped so slugs could read
            `/reinforcement-learning/transformers/notes`. That broke every
            subspace route: links kept emitting four segments (`/s/a/b/notes`)
            while the pattern matched three, so nothing matched and every
            topic, note, deck and quiz fell through to the 404 catch-all.
            Change these two together or not at all. */}
        <Route path="/s/:spaceId/:subspaceId">
          <Route
            index
            element={
              <Lazy>
                <ChatView />
              </Lazy>
            }
          />
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
          <Route
            path="skills"
            element={
              <Lazy>
                <SkillsView />
              </Lazy>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
