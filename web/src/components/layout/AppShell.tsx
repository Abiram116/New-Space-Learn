import { Outlet } from 'react-router-dom'
import { SpacesProvider } from '../../features/spaces/SpacesProvider'
import { Sidebar } from './Sidebar'
import { OfflineBanner } from './OfflineBanner'

export function AppShell() {
  return (
    <SpacesProvider>
      <div className="flex h-full flex-col bg-canvas">
        <OfflineBanner />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SpacesProvider>
  )
}
