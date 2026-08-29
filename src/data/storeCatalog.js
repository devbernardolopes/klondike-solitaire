// data/storeCatalog.js
// Single source of truth for the purchasable store catalog (public read from
// Supabase). Fetched once and cached at module scope so both StoreModal and
// ThemeModal share identical data without duplicate network calls, and so the
// "theme item → tab" mapping lives in exactly one place.
//
// Offline-first: fetchStoreCatalog() rejects when Supabase is unreachable;
// callers treat a failed/empty catalog gracefully (no items shown). This file
// imports the Supabase client only (never React/DOM), and is not part of core/.

import { supabase } from '../lib/supabaseClient.js';

// Currently the only kind is 'card_back'; widen as new theme kinds ship.
const THEME_KINDS = new Set(['card_back']);

/** @type {Record<string, string>} kind → Theme-modal tab label. */
const TAB_LABEL_BY_KIND = {
  card_back: 'Cards Back',
};

let cache = null;

/**
 * @typedef {Object} StoreItem
 * @property {string} id
 * @property {string} name
 * @property {string|null} description
 * @property {number} price
 * @property {string} kind
 * @property {string} asset_ref
 * @property {string|null} image_path
 */

/**
 * Fetch the enabled store_items catalog (ordered by sort_order). Cached after
 * the first successful call; pass `true` to force a refresh (e.g. after sign-out).
 * @param {boolean} [force]
 * @returns {Promise<StoreItem[]>}
 */
export async function fetchStoreCatalog(force = false) {
  if (cache && !force) return cache;
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('store_items')
    .select('id, name, description, price, kind, asset_ref, image_path')
    .eq('enabled', true)
    .order('sort_order');
  if (error) throw error;
  cache = data ?? [];
  return cache;
}

/** Drop the cached catalog (used on sign-out so a new identity refetches). */
export function clearStoreCatalogCache() {
  cache = null;
}

/** @param {string} kind */
export function isThemeKind(kind) {
  return THEME_KINDS.has(kind);
}

/** @param {string} kind @returns {string} */
export function tabLabelForKind(kind) {
  return TAB_LABEL_BY_KIND[kind] ?? 'Theme';
}
