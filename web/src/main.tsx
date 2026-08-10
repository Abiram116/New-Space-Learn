import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { ToastProvider } from './components/ui/Toast'
import { HandoffProvider } from './features/transitions/Handoff'
import { AssessmentProvider } from './lib/assessment'
import { armBootSplashFailsafe } from './lib/bootSplash'
import App from './App'
import './index.css'

// Armed at module load, not inside a component: the ceiling has to be running
// before any code that might not be reached.
armBootSplashFailsafe()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            {/* Above the router: an assessment can run in the chat dock or on
                its own page, and the composer that must lock is mounted in a
                different branch of the tree from both. */}
            <AssessmentProvider>
              {/* Above the router for one specific reason: these transitions
                  span a route change, and anything rendered inside a route
                  unmounts halfway through its own animation — ending on the
                  hard cut it was there to hide. */}
              <HandoffProvider>
                <App />
              </HandoffProvider>
            </AssessmentProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
