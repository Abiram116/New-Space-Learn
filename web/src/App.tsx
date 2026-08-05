import { Route, Routes } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth } from './auth/guards'
import { AppShell } from './components/layout/AppShell'
import { AuthCallback } from './features/auth/AuthCallback'
import { SignIn } from './features/auth/SignIn'
import { SignUp } from './features/auth/SignUp'
import { ChatView } from './features/chat/ChatView'
import { DocsView } from './features/docs/DocsView'
import { FlashcardsView } from './features/flashcards/FlashcardsView'
import { Home } from './features/home/Home'
import { Landing } from './features/landing/Landing'
import { NotesView } from './features/notes/NotesView'
import { Profile } from './features/profile/Profile'
import { QuizzesView } from './features/quizzes/QuizzesView'
import { Settings } from './features/settings/Settings'
import { SkillsView } from './features/skills/SkillsView'
import { NotFound } from './routes/NotFound'
import { RootRoute } from './routes/RootRoute'

export default function App() {
  return (
    <Routes>
      {/* `/` decides: signed in → the app, signed out → the pitch. */}
      <Route path="/" element={<RootRoute />} />
      {/* Always the pitch, so it stays linkable while signed in. */}
      <Route path="/welcome" element={<Landing />} />

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
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/s/:spaceId/:subspaceId">
          <Route index element={<ChatView />} />
          <Route path="docs" element={<DocsView />} />
          <Route path="notes" element={<NotesView />} />
          <Route path="flashcards" element={<FlashcardsView />} />
          <Route path="quizzes" element={<QuizzesView />} />
          <Route path="skills" element={<SkillsView />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
