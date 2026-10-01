import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { eventDashboardSchema, type EventDashboard } from "@eventdesk/contracts";
import { apiContract } from "@/lib/api";

export function useEventDashboard(eventId: string) {
  const client = useQueryClient();
  const queryKey = ["event-dashboard", eventId];
  const query = useQuery<EventDashboard>({ queryKey, queryFn: () => apiContract(`/events/${eventId}/dashboard`, eventDashboardSchema), enabled: Boolean(eventId), refetchInterval: 20_000 });
  useEffect(() => {
    if (!eventId) return;
    const stream = new EventSource(`/api/events/${eventId}/stream`, { withCredentials: true });
    const refresh = () => { void client.invalidateQueries({ queryKey }); };
    stream.addEventListener("checkin", refresh);
    stream.addEventListener("refresh", refresh);
    return () => stream.close();
  }, [client, eventId]);
  return query;
}
