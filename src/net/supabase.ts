/**
 * One Supabase client for everything server-backed in Kitti.
 * Anonymous auth: every browser gets a real, private user id without any sign-up.
 * The anon/publishable key is safe to ship — Row Level Security on every table
 * is what enforces ownership, not the key.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://rzbujszafrvvuzghcrrh.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_R_GVnnGER-b9hJYwD5wS5g__d2keKtF'
const URL = SUPABASE_URL
const ANON_KEY = SUPABASE_ANON_KEY

let client: SupabaseClient | null = null
export const sb = (): SupabaseClient => (client ??= createClient(URL, ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}))

let identityPromise: Promise<string> | null = null
/** Sign in anonymously (session persists in localStorage) and return the stable user id. */
export const ensureIdentity = (): Promise<string> => {
  if (!identityPromise) {
    identityPromise = (async () => {
      const { data } = await sb().auth.getSession()
      if (data.session?.user?.id) return data.session.user.id
      const { data: d2, error } = await sb().auth.signInAnonymously()
      if (error || !d2.session?.user?.id) throw error ?? new Error('Anonymous sign-in failed — enable Anonymous sign-ins in Authentication settings.')
      return d2.session.user.id
    })()
  }
  return identityPromise
}
