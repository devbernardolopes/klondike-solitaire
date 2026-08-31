// core/specialEvents.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
// Event identity (title, images) lives in the human-curated eventCatalog.json;
// the machine-generated 50 seeds per event live in specialEvents.json. The two
// are merged here by event id. Events are timeless (not bound to a year) and may
// number anything from a handful to many per year.

import catalog from '../data/eventCatalog.json' with { type: 'json' };
import seedsData from '../data/specialEvents.json' with { type: 'json' };

const FALLBACK_CATALOG = catalog && Array.isArray(catalog.events) ? catalog.events : [];
const FALLBACK_SEEDS_BY_ID = new Map(
  (seedsData && Array.isArray(seedsData.events) ? seedsData.events : []).map((e) => [e.id, e.seeds || []]),
);

function toEventArray(catalogArr, seedsById) {
  return catalogArr.map((meta) => ({
    id: meta.id,
    title: meta.title || meta.id,
    description: meta.description || '',
    images: Array.isArray(meta.images) ? meta.images : Array.isArray(meta.image_paths) ? meta.image_paths : [],
    seeds: seedsById.get(meta.id) || [],
  }));
}

function resolveCatalogAndSeeds(injected) {
  if (Array.isArray(injected) && injected.length && typeof injected[0] === 'object' && 'seeds' in injected[0]) {
    const cat = injected.map((e) => ({ id: e.id, title: e.title, description: e.description, images: e.images || e.image_paths || [] }));
    const map = new Map(injected.map((e) => [e.id, e.seeds || []]));
    return { catalog: cat, seedsById: map };
  }
  return { catalog: FALLBACK_CATALOG, seedsById: FALLBACK_SEEDS_BY_ID };
}

/** All curated event ids, in catalog order. @returns {string[]} */
export function listEventIds(events = null) {
  const { catalog } = resolveCatalogAndSeeds(events);
  return catalog.map((e) => e.id);
}

/**
 * Merge curated metadata with generated seeds for one event.
 * @param {string} id
 * @param {Array} [events]  injected event array from repo; defaults to bundled fallback
 * @returns {{id:string,title:string,images:string[],seeds:number[]}|null}
 */
export function getEvent(id, events = null) {
  const { catalog, seedsById } = resolveCatalogAndSeeds(events);
  const meta = catalog.find((e) => e.id === id);
  if (!meta) return null;
  return {
    id,
    title: meta.title || id,
    description: meta.description || '',
    images: Array.isArray(meta.images) ? meta.images : Array.isArray(meta.image_paths) ? meta.image_paths : [],
    seeds: seedsById.get(id) || [],
  };
}

/** The 50 generated seeds for an event (empty if unknown). @param {string} id */
export function seedsForEvent(id, events = null) {
  const ev = getEvent(id, events);
  return ev ? ev.seeds : [];
}

/** Every event merged with its seeds, in catalog order. */
export function listEvents(events = null) {
  const { catalog, seedsById } = resolveCatalogAndSeeds(events);
  return toEventArray(catalog, seedsById);
}
