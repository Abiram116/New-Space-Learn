/**
 * Global spaces context.
 *
 * Owns the space + subspace list so the sidebar and every subspace route
 * read from one place. Also exposes CRUD helpers that keep the local list in
 * sync without a full refetch — sidebar snappiness matters.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createSpace,
  createSubspace as createSubspaceApi,
  deleteSpace as deleteSpaceApi,
  deleteSubspace as deleteSubspaceApi,
  listSpaces,
  renameSubspace as renameSubspaceApi,
  updateSpace,
} from '../../api/spaces'
import type { Space, Subspace, Tone } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { useAuth } from '../../auth/AuthProvider'

type Ctx = {
  spaces: Space[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  createSpace: (input: { name: string; tone: Tone }) => Promise<Space>
  renameSpace: (id: string, name: string) => Promise<void>
  changeTone: (id: string, tone: Tone) => Promise<void>
  deleteSpace: (id: string) => Promise<void>
  addSubspace: (spaceId: string, name: string) => Promise<Subspace>
  renameSubspace: (id: string, name: string) => Promise<void>
  deleteSubspace: (id: string) => Promise<void>
}

const SpacesCtx = createContext<Ctx | null>(null)

export function SpacesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  // The STABLE half of the session, not the object. Supabase hands out a new
  // `Session` object on nearly every internal event it fires — including
  // harmless token-refresh no-ops where the signed-in user hasn't changed —
  // so the object reference changes far more often than the actual auth
  // state does. `refresh` used to depend on `session` itself, which meant
  // every one of those object-identity churns rebuilt the callback, re-ran
  // the effect below, and fired a fresh `/spaces` request — measured as
  // dozens of concurrent calls to the same endpoint within one page load.
  // The user id only changes on an actual sign-in/sign-out, which is the
  // only time this provider has any reason to refetch.
  const userId = session?.user?.id ?? null
  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  // Belt and braces alongside the dependency fix above: even a legitimate
  // double-call (StrictMode's dev-mode double-invoke, a fast remount) now
  // joins the SAME in-flight request instead of firing a second one.
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (!userId) {
      setSpaces([])
      setLoading(false)
      return
    }
    if (inFlight.current) return inFlight.current

    const gen = ++generation.current
    setLoading(true)
    setError(null)
    const run = (async () => {
      try {
        const list = await listSpaces()
        if (gen !== generation.current) return
        setSpaces(list)
      } catch (err) {
        if (gen !== generation.current) return
        setError(friendlyMessage(err))
      } finally {
        if (gen === generation.current) setLoading(false)
        inFlight.current = null
      }
    })()
    inFlight.current = run
    return run
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<Ctx>(
    () => ({
      spaces,
      loading,
      error,
      refresh,
      createSpace: async (input) => {
        const created = await createSpace(input)
        setSpaces((prev) => [...prev, { ...created, subspaces: [] }])
        return created
      },
      renameSpace: async (id, name) => {
        await updateSpace(id, { name })
        setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
      },
      changeTone: async (id, tone) => {
        await updateSpace(id, { tone })
        setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, tone } : s)))
      },
      deleteSpace: async (id) => {
        await deleteSpaceApi(id)
        setSpaces((prev) => prev.filter((s) => s.id !== id))
      },
      addSubspace: async (spaceId, name) => {
        const created = await createSubspaceApi(spaceId, { name })
        setSpaces((prev) =>
          prev.map((s) =>
            s.id === spaceId ? { ...s, subspaces: [...s.subspaces, created] } : s,
          ),
        )
        return created
      },
      renameSubspace: async (id, name) => {
        await renameSubspaceApi(id, { name })
        setSpaces((prev) =>
          prev.map((s) => ({
            ...s,
            subspaces: s.subspaces.map((sub) => (sub.id === id ? { ...sub, name } : sub)),
          })),
        )
      },
      deleteSubspace: async (id) => {
        await deleteSubspaceApi(id)
        setSpaces((prev) =>
          prev.map((s) => ({
            ...s,
            subspaces: s.subspaces.filter((sub) => sub.id !== id),
          })),
        )
      },
    }),
    [spaces, loading, error, refresh],
  )

  return <SpacesCtx.Provider value={value}>{children}</SpacesCtx.Provider>
}

export function useSpaces(): Ctx {
  const ctx = useContext(SpacesCtx)
  if (!ctx) throw new Error('useSpaces must be used inside <SpacesProvider>')
  return ctx
}
