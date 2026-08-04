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
  const [spaces, setSpaces] = useState<Space[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    if (!session) {
      setSpaces([])
      setLoading(false)
      return
    }
    const gen = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const list = await listSpaces()
      if (gen !== generation.current) return
      setSpaces(list)
    } catch (err) {
      if (gen !== generation.current) return
      setError(friendlyMessage(err))
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [session])

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
