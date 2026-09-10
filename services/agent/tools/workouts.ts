// Resource-adapter functions for the workouts domain (sections, movements,
// variations, variation_history), consumed by the generic list_resources /
// get_resource agent tools defined in analytics.ts. Every function threads
// userUuid through and calls straight into services/workouts -- no new SQL.
import * as workouts from '../../workouts';
import type { HistoryEntry } from '../../workouts';

export async function getWorkoutTree(userUuid: string) {
  return workouts.getWorkoutTree(userUuid);
}

export async function listSections(userUuid: string) {
  return workouts.listSectionsForUser(userUuid);
}

export async function getSection(userUuid: string, id: string) {
  return workouts.getSectionById(userUuid, id);
}

/** Null means sectionId isn't owned by userUuid. */
export async function listMovements(userUuid: string, sectionId: string) {
  if (!(await workouts.ownsSection(userUuid, sectionId))) return null;
  return workouts.listMovementsForSection(sectionId);
}

export async function getMovement(userUuid: string, id: string) {
  return workouts.getMovementById(userUuid, id);
}

/** Null means movementId isn't owned by userUuid. */
export async function listVariations(userUuid: string, movementId: string) {
  if (!(await workouts.ownsMovement(userUuid, movementId))) return null;
  return workouts.listVariationsForMovement(movementId);
}

export async function getVariation(userUuid: string, id: string) {
  return workouts.getVariationById(userUuid, id);
}

/**
 * Null means variationId isn't owned by userUuid. An empty array is still a
 * valid result: a variation that was never PATCHed has zero variation_history
 * rows (see appendHistoryIfChanged in services/workouts/variations.ts), which
 * means "never edited", not "never trained" -- the tool layer surfaces that
 * distinction in its output rather than this adapter.
 */
export async function listVariationHistory(
  userUuid: string,
  variationId: string,
  from?: string,
  to?: string,
): Promise<HistoryEntry[] | null> {
  if (!(await workouts.ownsVariation(userUuid, variationId))) return null;
  return workouts.getHistory(variationId, from, to);
}
