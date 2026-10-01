import { EventEmitter } from "node:events";
import type { CheckInNotice } from "@eventdesk/contracts";

const hub = new EventEmitter();
hub.setMaxListeners(0);

export function publishCheckIn(notice: CheckInNotice): void {
  hub.emit(`event:${notice.eventId}`, notice);
}

export function subscribeToEvent(eventId: string, listener: (notice: CheckInNotice) => void): () => void {
  const key = `event:${eventId}`;
  hub.on(key, listener);
  return () => hub.off(key, listener);
}
