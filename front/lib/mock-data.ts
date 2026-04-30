// This file is kept for backwards compatibility with admin pages.
// The dashboard now uses the real API. See lib/api.ts.

export const mockUsers: unknown[] = []
export const mockTasks: unknown[] = []
export function getCurrentUser() { return null }
export function getUserTasks(_userId: string) { return [] }
export function getTask(_taskId: string) { return undefined }
export function getAllUsers() { return [] }
export function getUser(_userId: string) { return undefined }
