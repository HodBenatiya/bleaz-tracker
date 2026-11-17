import { createContext, useContext, type ReactNode } from 'react'
import type { AppRole } from '../utils/accessRole'

const AccessContext = createContext<AppRole>('admin')

export function AccessProvider({ role, children }: { role: AppRole; children: ReactNode }) {
  return <AccessContext.Provider value={role}>{children}</AccessContext.Provider>
}

export function useAppRole(): AppRole {
  return useContext(AccessContext)
}

/** False for the viewer. Admins keep every control they have today. */
export function useCanEdit(): boolean {
  return useAppRole() === 'admin'
}
