// Resource-adapters for the habit and habit_tally resources, consumed by the
// generic list_resources agent tool in analytics.ts. Neither has a
// single-item getter -- only listing is supported. habit_tallies join the
// habits registry by name, not id, so a tally can exist for a habitName with
// no matching registry row; listTallies doesn't check the registry, and
// neither does this adapter.
import { listHabits, listTallies } from '../../habits/store';

export async function listHabitsResource(userUuid: string) {
  return listHabits(userUuid);
}

export async function listHabitTallies(userUuid: string, habitName: string, from?: string, to?: string) {
  return listTallies(userUuid, habitName, { from, to });
}
