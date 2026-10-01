import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, MapPin, Palette, Pencil, Plus, Save, Ticket, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { contractJson, eventInputSchema, eventListSchema, eventSummarySchema, eventUpdateSchema, projectSchema, projectUpdateSchema, type EventSummary, type Project } from "@eventdesk/contracts";
import { apiContract, apiNoContent, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [venue, setVenue] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEventName, setEditEventName] = useState("");
  const [editStartsAt, setEditStartsAt] = useState("");
  const [editVenue, setEditVenue] = useState("");

  const project = useQuery<Project>({ queryKey: ["project", projectId], queryFn: () => apiContract(`/projects/${projectId}`, projectSchema), enabled: Boolean(projectId) });
  const events = useQuery<EventSummary[]>({ queryKey: ["events", projectId], queryFn: () => apiContract(`/projects/${projectId}/events`, eventListSchema), enabled: Boolean(projectId) });
  const isOwner = project.data?.role === "owner";

  const createEvent = useMutation({
    mutationFn: () => apiContract(`/projects/${projectId}/events`, eventSummarySchema, { method: "POST", body: contractJson(eventInputSchema, { name, venue, startsAt: startsAt ? new Date(startsAt).toISOString() : undefined }) }),
    onSuccess: async (event) => { await client.invalidateQueries({ queryKey: ["events", projectId] }); await client.invalidateQueries({ queryKey: ["projects"] }); setName(""); setStartsAt(""); setVenue(""); toast.success("Event created and attendee tables provisioned."); navigate(`/admin/events/${event.id}`); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create event."),
  });
  const renameProject = useMutation({
    mutationFn: (nextName: string) => apiContract(`/projects/${projectId}`, projectSchema, { method: "PATCH", body: contractJson(projectUpdateSchema, { name: nextName }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["project", projectId] }); await client.invalidateQueries({ queryKey: ["projects"] }); setRenameOpen(false); toast.success("Project renamed."); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not rename the project."),
  });
  const deleteProject = useMutation({
    mutationFn: () => apiNoContent(`/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["projects"] }); toast.success("Project and its isolated event data were deleted."); navigate("/admin", { replace: true }); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not delete the project."),
  });
  const updateEvent = useMutation({
    mutationFn: (input: { eventId: string; name: string; startsAt: string | null; venue: string | null }) =>
      apiContract(`/events/${input.eventId}`, eventSummarySchema, { method: "PATCH", body: contractJson(eventUpdateSchema, { name: input.name, startsAt: input.startsAt, venue: input.venue }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["events", projectId] }); setEditingEventId(null); toast.success("Event details saved."); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not update the event."),
  });
  const deleteEvent = useMutation({
    mutationFn: (eventId: string) => apiNoContent(`/events/${eventId}`, { method: "DELETE" }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["events", projectId] }); await client.invalidateQueries({ queryKey: ["projects"] }); toast.success("Event and its isolated attendee/check-in data were deleted."); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not delete the event."),
  });

  const submitNewEvent = (event: FormEvent) => { event.preventDefault(); createEvent.mutate(); };
  const submitRename = (event: FormEvent) => { event.preventDefault(); if (renameName.trim()) renameProject.mutate(renameName.trim()); };
  const beginEventEdit = (event: EventSummary) => {
    setEditingEventId(event.id);
    setEditEventName(event.name);
    setEditStartsAt(toLocalDateTime(event.startsAt));
    setEditVenue(event.venue ?? "");
  };
  const submitEventEdit = (event: FormEvent, eventId: string) => {
    event.preventDefault();
    updateEvent.mutate({ eventId, name: editEventName.trim(), startsAt: editStartsAt ? new Date(editStartsAt).toISOString() : null, venue: editVenue.trim() || null });
  };
  const confirmDeleteProject = () => {
    const projectName = project.data?.name;
    if (!isOwner || !projectName) return;
    const confirmation = window.prompt(`This permanently deletes “${projectName}”, all its events, and their isolated attendee/check-in data. Type the exact project name to continue.`);
    if (confirmation === projectName) deleteProject.mutate();
    else if (confirmation !== null) toast.error("Project name did not match; nothing was deleted.");
  };
  const confirmDeleteEvent = (event: EventSummary) => {
    if (!isOwner) return;
    const confirmation = window.prompt(`This permanently deletes “${event.name}” and its attendee/check-in data. Type the exact event name to continue.`);
    if (confirmation === event.name) deleteEvent.mutate(event.id);
    else if (confirmation !== null) toast.error("Event name did not match; nothing was deleted.");
  };

  const title = project.data?.name ?? (project.isLoading ? "Loading project…" : "Project");
  const headerAction = <div className="flex flex-wrap items-center gap-2"><Link to="/admin"><Button variant="outline" size="sm">All projects</Button></Link>{isOwner && <><Link to={`/admin/projects/${projectId}/branding`}><Button variant="outline" size="sm"><Palette className="h-3.5 w-3.5" />Branding</Button></Link><Button variant="outline" size="sm" onClick={() => { setRenameName(project.data?.name ?? ""); setRenameOpen((open) => !open); }}><Pencil className="h-3.5 w-3.5" />Rename</Button><Button variant="destructive" size="sm" disabled={deleteProject.isPending} onClick={confirmDeleteProject}><Trash2 className="h-3.5 w-3.5" />{deleteProject.isPending ? "Deleting…" : "Delete project"}</Button></>}</div>;

  return <div className="page-enter">
    <PageHeader eyebrow="Projects / workspace" title={title} description="Organize this workspace's events. Every event receives private attendee and check-in tables." action={headerAction} />
    {project.isError && <Card className="mb-5"><CardContent className="p-5 text-sm text-destructive">Could not load this project or you do not have access.</CardContent></Card>}
    {renameOpen && isOwner && <Card className="mb-6"><CardContent className="p-5"><form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submitRename}><label className="block flex-1"><span className="label-caps mb-2 block">Project name</span><input className="input-control" value={renameName} onChange={(event) => setRenameName(event.target.value)} minLength={2} maxLength={120} required /></label><Button type="button" variant="outline" onClick={() => setRenameOpen(false)}><X className="h-4 w-4" />Cancel</Button><Button type="submit" disabled={renameProject.isPending || renameName.trim().length < 2}><Save className="h-4 w-4" />Save name</Button></form></CardContent></Card>}

    <div className="grid gap-7 xl:grid-cols-[1.45fr_.75fr]">
      <section><div className="mb-4 flex items-center justify-between"><div><h2 className="panel-title">Events</h2><p className="mt-1 text-xs text-muted-foreground">Event context scopes every scan and attendee query.</p></div><Badge tone="default">{events.data?.length ?? 0} events</Badge></div>
        {events.isLoading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading events…</CardContent></Card> : events.isError ? <Card><CardContent className="p-6 text-sm text-destructive">Could not load events. Refresh and try again.</CardContent></Card> : events.data?.length ? <div className="space-y-3">{events.data.map((event) => <Card key={event.id}><CardContent className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><Link to={`/admin/events/${event.id}`} className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-primary"><Ticket className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h3 className="font-display text-base font-semibold">{event.name}</h3><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{event.startsAt && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{new Date(event.startsAt).toLocaleString()}</span>}{event.venue && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{event.venue}</span>}<span className="inline-flex items-center gap-1.5 text-primary">Open event <ArrowRight className="h-3.5 w-3.5" /></span></div></div></Link>{isOwner && <div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" onClick={() => beginEventEdit(event)} aria-label={`Edit ${event.name}`}><Pencil className="h-3.5 w-3.5" />Edit</Button><Button variant="destructive" size="sm" disabled={deleteEvent.isPending} onClick={() => confirmDeleteEvent(event)} aria-label={`Delete ${event.name}`}><Trash2 className="h-3.5 w-3.5" />Delete</Button></div>}</div>{editingEventId === event.id && <form className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2" onSubmit={(formEvent) => submitEventEdit(formEvent, event.id)}><label className="block"><span className="label-caps mb-2 block">Event name</span><input className="input-control" value={editEventName} onChange={(inputEvent) => setEditEventName(inputEvent.target.value)} minLength={2} maxLength={160} required /></label><label className="block"><span className="label-caps mb-2 block">Date and time</span><input className="input-control" type="datetime-local" value={editStartsAt} onChange={(inputEvent) => setEditStartsAt(inputEvent.target.value)} /></label><label className="block sm:col-span-2"><span className="label-caps mb-2 block">Venue</span><input className="input-control" maxLength={240} value={editVenue} onChange={(inputEvent) => setEditVenue(inputEvent.target.value)} /></label><div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => setEditingEventId(null)}><X className="h-4 w-4" />Cancel</Button><Button type="submit" disabled={updateEvent.isPending || editEventName.trim().length < 2}><Save className="h-4 w-4" />{updateEvent.isPending ? "Saving…" : "Save event"}</Button></div></form>}</CardContent></Card>)}</div> : <Card><CardContent className="flex min-h-48 flex-col items-center justify-center p-8 text-center"><div className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><CalendarDays className="h-5 w-5" /></div><h3 className="mt-4 font-display font-semibold">No events in this project yet</h3><p className="mt-1 text-xs text-muted-foreground">Create the first event to start adding attendees.</p></CardContent></Card>}
      </section>
      <Card className="h-fit"><CardContent className="p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Plus className="h-5 w-5" /></div><div><h2 className="panel-title">Create event</h2><p className="text-xs text-muted-foreground">Sets up isolated attendee tables</p></div></div><form className="mt-5 space-y-3.5" onSubmit={submitNewEvent}><label className="block"><span className="label-caps mb-2 block">Event name</span><input className="input-control" required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Product summit 2026" /></label><label className="block"><span className="label-caps mb-2 block">Date and time</span><input className="input-control" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="block"><span className="label-caps mb-2 block">Venue</span><input className="input-control" maxLength={240} value={venue} onChange={(event) => setVenue(event.target.value)} placeholder="Convention hall" /></label><Button className="mt-1 w-full" disabled={createEvent.isPending || name.trim().length < 2}>{createEvent.isPending ? "Preparing event tables…" : "Create event"}</Button></form></CardContent></Card>
    </div>
  </div>;
}
