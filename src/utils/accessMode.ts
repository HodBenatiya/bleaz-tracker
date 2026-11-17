import type { AppRole } from './accessRole'

/** Module flag so data loaders can branch without a React import. Defaults to admin. */
let role: AppRole = 'admin'

export function setActiveRole(next: AppRole): void {
  role = next
}

export function activeRole(): AppRole {
  return role
}

export function isViewer(): boolean {
  return role === 'viewer'
}
