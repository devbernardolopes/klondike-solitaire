import { db } from './schema.js';

export async function saveCatalogDetail(detail) {
  if (!detail || !detail.id) return;
  await db.eventCatalogCache.put({ eventId: detail.id, detail, updatedAt: Date.now() });
}

export async function getCatalogDetail(eventId) {
  const row = await db.eventCatalogCache.get(eventId);
  return row?.detail ?? null;
}

export async function listCatalogDetails() {
  return db.eventCatalogCache.toArray();
}

export async function deleteCatalogDetail(eventId) {
  await db.eventCatalogCache.delete(eventId);
}

export async function getImageBlob(imagePath) {
  const row = await db.eventImageCache.get(imagePath);
  return row?.blob ?? null;
}

export async function saveImageBlob(imagePath, blob) {
  await db.eventImageCache.put({ imagePath, blob, updatedAt: Date.now() });
}

export async function deleteImageBlob(imagePath) {
  await db.eventImageCache.delete(imagePath);
}
