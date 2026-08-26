// lib/supabaseClient.js
// Shared Supabase client. Only responsible for constructing the singleton
// client from Vite env vars; it does NOT own auth state (see hooks/useAuthStore)
// or any sync/persistence logic — those layers consume this export.

import { createClient } from '@supabase/supabase-js';

// import.meta.env is supplied by Vite in the app; under the raw Node test runner
// (and any non-Vite context) it is undefined. Guard so importing this module
// never throws, and degrade to a null client when the env is absent.
const env = import.meta.env || {};
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loud in dev; don't silently run with a broken client.
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill them in.',
  );
}

// Default persistSession/autoRefreshToken (both on) are exactly what we want:
// the session survives reloads via localStorage without an extra network round
// trip, which matters for offline-first. When the env is missing we export null
// rather than constructing a broken client (callers must tolerate no session).
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
