// core/specialEvents.js
// Framework-agnostic. No React / DOM / UI imports allowed in this file.
// Event identity (title, images) lives in the human-curated eventCatalog.json;
// the machine-generated 50 seeds per event live in specialEvents.json. The two
// are merged here by event id. Events are timeless (not bound to a year) and may
// number anything from a handful to many per year.

import catalog from '../data/eventCatalog.json' with { type: 'json' };
import seedsData from '../data/specialEvents.json' with { type: 'json' };

const CATALOG = catalog && Array.isArray(catalog.events) ? catalog.events : [];
const SEEDS_BY_ID = new Map(
  (seedsData && Array.isArray(seedsData.events) ? seedsData.events : []).map((e) => [e.id, e.seeds || []]),
);

/** All curated event ids, in catalog order. @returns {string[]} */
export function listEventIds() {
  return CATALOG.map((e) => e.id);
}

/**
 * Merge curated metadata with generated seeds for one event.
 * @param {string} id
 * @returns {{id:string,title:string,images:string[],seeds:number[]}|null}
 */
export function getEvent(id) {
  const meta = CATALOG.find((e) => e.id === id);
  if (!meta) return null;
  return {
    id,
    title: meta.title || id,
    images: Array.isArray(meta.images) ? meta.images : [],
    seeds: SEEDS_BY_ID.get(id) || [],
  };
}

/** The 50 generated seeds for an event (empty if unknown). @param {string} id */
export function seedsForEvent(id) {
  const ev = getEvent(id);
  return ev ? ev.seeds : [];
}

/** Every event merged with its seeds, in catalog order. */
export function listEvents() {
  return CATALOG.map((e) => getEvent(e.id));
}
