/**
 * Global test setup: jest-dom matchers only.
 *
 * Deliberately does NOT touch `document` or instantiate anything — this file
 * runs for every test file, including the pure-logic ones under the default
 * `node` environment (see `vite.config.ts`), and those must stay cheap.
 * `expect.extend` is a plain object registration; it costs nothing whether or
 * not a given file ever renders a component.
 *
 * React Testing Library's own `cleanup()` (unmounting between tests) is
 * *not* registered globally for the same reason — it is a no-op in a
 * `node`-environment file with nothing mounted, but importing
 * `@testing-library/react` at all pulls in React's test utilities, and doing
 * that for every file just to serve the handful that render something is the
 * cost this project has repeatedly chosen not to pay by default. Component
 * tests import `cleanup` themselves — see `ChatMessage.dom.test.tsx`.
 */
import '@testing-library/jest-dom/vitest'
