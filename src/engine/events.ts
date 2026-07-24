import type { EngineEvent, EngineEventName } from './types.js';
import { EngineStore } from './store.js';
import { randomIdFactory } from './ids.js';
import { systemClock } from './clock.js';

const COLLECTION = 'events';

export async function emitEvent(
  store: EngineStore,
  name: EngineEventName,
  projectId: string,
  data?: Record<string, unknown>,
  taskId?: string,
): Promise<EngineEvent> {
  const id = randomIdFactory('ev');
  const evt: EngineEvent & { id: string } = {
    id,
    name,
    projectId,
    taskId,
    at: systemClock(),
    data,
  };
  await store.put(COLLECTION, evt);
  return evt;
}

export async function listEvents(
  store: EngineStore,
  projectId: string,
  sinceIso?: string,
): Promise<EngineEvent[]> {
  const all = await store.list<EngineEvent & { id: string }>(COLLECTION);
  return all
    .filter((e) => e.projectId === projectId)
    .filter((e) => !sinceIso || e.at > sinceIso)
    .sort((a, b) => a.at.localeCompare(b.at));
}
