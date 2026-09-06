// Resource-adapter for the body_weight resource, consumed by the generic
// list_resources agent tool in analytics.ts. body_weight has no single-item
// getter -- only a user-scoped, optionally range-bounded list is supported.
import { listEntries } from '../../bodyWeight/store';

export async function listBodyWeight(userUuid: string, from?: string, to?: string) {
  return listEntries(userUuid, from, to);
}
