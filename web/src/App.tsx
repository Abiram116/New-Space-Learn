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
import { NotesView } from './features/notes/NotesView'
import { Profile } from './features/profile/Profile'
import { QuizzesView } from './features/quizzes/QuizzesView'
import { Settings } from './features/settings/Settings'
import { SkillsView } from './features/skills/SkillsView'
import { NotFound } from './routes/NotFound'

export default function App() {
  return (
    <Routes>
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
        <Route path="/" element={<Home />} />
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
