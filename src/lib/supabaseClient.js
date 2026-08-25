// lib/supabaseClient.js
// Shared Supabase client. Only responsible for constructing the singleton
// client from Vite env vars; it does NOT own auth state (see hooks/useAuthStore)
// or any sync/persistence logic — those layers consume this export.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loud in dev; don't silently run with a broken client.
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill them in.',
  );
}

// Default persistSession/autoRefreshToken (both on) are exactly what we want:
// the session survives reloads via localStorage without an extra network round
// trip, which matters for offline-first.
export const supabase = createClient(url, anonKey);
