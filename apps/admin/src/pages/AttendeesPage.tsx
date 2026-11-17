import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, Check, FileArchive, FilePlus2, FileText, Link2, Plus, Search, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { apiErrorResponseSchema, attendeeImportSchema, attendeeInputSchema, attendeeListSchema, attendeeQrIssueSchema, badgeArchiveFilenames, badgeArchiveInputSchema, bulkAttendeeResultSchema, clearAttendeesResultSchema, contractJson, customFieldKeySchema, issuedAttendeeSchema, type Attendee, type AttendeeInput, type BulkAttendeeResult, type IssuedAttendee } from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { useEventDashboard } from "@/hooks/useEventDashboard";
import { EventTabs, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { readAttendeeFile, type AttendeeFile } from "@/lib/attendee-file";


type BadgeArchiveSelection = {
  attendees: Attendee[];
  options: { value: string; label: string }[];
  primary: string;
  secondary: string;
};

function badgeArchiveSelection(attendees: Attendee[]): BadgeArchiveSelection {
  const customFields = [...new Set(attendees.flatMap((attendee) => Object.keys(attendee.customFields)))];
  const standardFields = [{ value: "name", label: "Name" }, { value: "email", label: "Email" }, { value: "ticketType", label: "Ticket type" }] as const;
  const options = [
    { value: "id", label: "Record ID" },
    ...standardFields.filter(({ value }) => attendees.some((attendee) => attendee[value])),
    ...customFields.map((field) => ({ value: `custom:${field}`, label: `${field} (custom field)` })),
  ];
  const importedId = customFields.find((field) => /^(?:attendee)?id$/i.test(field.replace(/[\s_-]+/g, "")));
  const importedName = customFields.find((field) => /^(?:fullname|attendeename|الاسم|الاسمالكامل|اسم)$/i.test(field.replace(/[\s_-]+/g, "")));
  const nameField = options.some(({ value }) => value === "name") ? "name" : importedName ? `custom:${importedName}` : "";
  return {
    attendees,
    options,
    primary: importedId ? `custom:${importedId}` : "id",
    secondary: nameField,
  };
}

function saveDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_500);
}

function attendeeFilename(attendee: Pick<Attendee, "id" | "name">): string {
  return attendee.name?.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || attendee.id;
}

export function AttendeesPage() {
  const { eventId = "" } = useParams();
  return <EventAttendees key={eventId} eventId={eventId} />;
}

function EventAttendees({ eventId }: { eventId: string }) {
  const client = useQueryClient();
  const eventQuery = useEventDashboard(eventId);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [created, setCreated] = useState<IssuedAttendee | null>(null);
  const [bulkCreated, setBulkCreated] = useState<BulkAttendeeResult | null>(null);
  const [attendeeFile, setAttendeeFile] = useState<AttendeeFile | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [savedImport, setSavedImport] = useState<Attendee[]>([]);
  const [bulkError, setBulkError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ticketType, setTicketType] = useState("General");
  const [customFields, setCustomFields] = useState<Array<{ id: string; key: string; value: string }>>([]);
  const [downloadingBadgeId, setDownloadingBadgeId] = useState<string | null>(null);
  const [archive, setArchive] = useState<BadgeArchiveSelection | null>(null);
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  const attendees = useQuery<Attendee[]>({ queryKey: ["attendees", eventId, q, status], queryFn: () => apiContract(`/events/${eventId}/attendees?q=${encodeURIComponent(q)}&status=${status}`, attendeeListSchema), enabled: Boolean(eventId) });
  const refreshRows = async () => {
    await client.invalidateQueries({ queryKey: ["attendees", eventId] });
    await client.invalidateQueries({ queryKey: ["attendee-fields", eventId] });
    await client.invalidateQueries({ queryKey: ["event-dashboard", eventId] });
  };
  const addAttendee = useMutation({
    mutationFn: (values: AttendeeInput) => apiContract(`/events/${eventId}/attendees`, issuedAttendeeSchema, { method: "POST", body: contractJson(attendeeInputSchema, values) }),
    onSuccess: async (value) => { setCreated(value); setName(""); setEmail(""); setTicketType("General"); setCustomFields([]); setShowForm(false); await refreshRows(); toast.success("Attendee added. Their QR code is ready."); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not add attendee."),
  });
  const addBulk = useMutation({
    mutationFn: (file: AttendeeFile) => apiContract(`/events/${eventId}/attendees/import`, attendeeListSchema, { method: "POST", body: contractJson(attendeeImportSchema, { attendees: file.attendees }) }),
    onSuccess: async (saved) => {
      setSavedImport(saved);
      setAttendeeFile(null);
      setShowBulk(false);
      await refreshRows();
      toast.success(`${saved.length} attendees saved.`);
    },
    onError: (error) => setBulkError(error instanceof ApiError ? error.message : "Could not save attendees."),
  });
  const issueQr = useMutation({
    mutationFn: ({ ids }: { ids: string[]; fromImport: boolean }) => apiContract(`/events/${eventId}/attendees/issue-qr`, bulkAttendeeResultSchema, { method: "POST", body: contractJson(attendeeQrIssueSchema, { attendeeIds: ids }) }),
    onSuccess: async (issued, { fromImport }) => {
      if (fromImport) setSavedImport([]);
      setBulkCreated(issued);
      await refreshRows();
      toast.success(`${issued.count} QR codes ready.`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not generate QR codes."),
  });
  const clearAttendees = useMutation({
    mutationFn: () => apiContract(`/events/${eventId}/attendees`, clearAttendeesResultSchema, { method: "DELETE" }),
    onSuccess: async ({ deletedCount }) => {
      setCreated(null);
      setBulkCreated(null);
      setSavedImport([]);
      setArchive(null);
      setQ("");
      setStatus("all");
      await client.cancelQueries({ queryKey: ["attendees", eventId] });
      client.setQueriesData<Attendee[]>({ queryKey: ["attendees", eventId] }, []);
      await refreshRows();
      toast.success(deletedCount === 1 ? "1 attendee removed." : `${deletedCount} attendees removed.`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not clear the attendee list."),
  });
  const clearing = clearAttendees.isPending;
  const canClear = eventQuery.data?.canClearAttendees !== false;
  const clearDisabled = !canClear || clearing || addAttendee.isPending || addBulk.isPending || issueQr.isPending || downloadingBulk || Boolean(downloadingBadgeId);
  const confirmClear = () => {
    if (clearDisabled) return;
    const eventName = eventQuery.data?.event.name ?? "this event";
    if (window.confirm(`Permanently clear all attendees from ${eventName}? This removes their check-in history and invalidates their QR codes.`)) {
      clearAttendees.mutate();
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (clearing) return;
    try {
      const values: Record<string, string> = {};
      const seen = new Set<string>();
      for (const field of customFields) {
        if (!field.key.trim() && !field.value.trim()) continue;
        const key = customFieldKeySchema.parse(field.key);
        if (seen.has(key.toLowerCase())) throw new Error(`Custom field “${key}” appears more than once.`);
        seen.add(key.toLowerCase());
        values[key] = field.value;
      }
      addAttendee.mutate(attendeeInputSchema.parse({ name, email, ticketType, customFields: values }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check the attendee fields and try again.");
    }
  };
  const selectAttendeeFile = async (file: File) => {
    setAttendeeFile(null);
    setBulkError("");
    setReadingFile(true);
    try {
      setAttendeeFile(await readAttendeeFile(file));
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Could not read the file.");
    } finally {
      setReadingFile(false);
    }
  };

  const submitBulk = (event: FormEvent) => {
    event.preventDefault();
    if (!attendeeFile || addBulk.isPending || clearing) return;
    setBulkError("");
    addBulk.mutate(attendeeFile);
  };

  const downloadBadge = async (attendee: Pick<Attendee, "id" | "name">) => {
    if (clearing) return;
    setDownloadingBadgeId(attendee.id);
    try {
      const response = await fetch(`/api/events/${eventId}/attendees/${attendee.id}/badge.pdf`, {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const parsed = apiErrorResponseSchema.safeParse(payload);
        throw new Error(parsed.success ? parsed.data.error : `Badge download failed (${response.status}).`);
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("The server did not return a badge PDF.");
      const blob = await response.blob();
      if (!blob.size) throw new Error("The badge PDF was empty.");
      saveDownload(blob, `eventdesk-${attendeeFilename(attendee)}-badge.pdf`);
      toast.success("Designed badge downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the designed badge.");
    } finally {
      setDownloadingBadgeId(null);
    }
  };
  const downloadBadgeArchive = async (event: FormEvent) => {
    event.preventDefault();
    if (!archive || downloadingBulk || clearing) return;
    const filenameFields = [archive.primary, archive.secondary].filter(Boolean);
    setDownloadingBulk(true);
    try {
      const response = await fetch(`/api/events/${eventId}/badges/bulk.zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/zip" },
        body: contractJson(badgeArchiveInputSchema, {
          attendeeIds: archive.attendees.map((attendee) => attendee.id),
          filenameFields,
        }),
        cache: "no-store",
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const parsed = apiErrorResponseSchema.safeParse(payload);
        throw new Error(parsed.success ? parsed.data.error : `Badge archive download failed (${response.status}).`);
      }
      if (!response.headers.get("content-type")?.includes("application/zip")) throw new Error("The server did not return a badge ZIP.");
      const blob = await response.blob();
      if (!blob.size) throw new Error("The badge ZIP was empty.");
      saveDownload(blob, "eventdesk-badges.zip");
      toast.success(`Downloaded ${archive.attendees.length} badges.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the badge ZIP.");
    } finally {
      setDownloadingBulk(false);
    }
  };

  const rows = attendees.data ?? [];
  const badgeReady = rows.filter((attendee) => attendee.qrIssued !== false);
  const archivePreview = archive && badgeArchiveFilenames(archive.attendees.slice(0, 1), [archive.primary, archive.secondary].filter(Boolean))[0];
  const missingQrIds = rows.filter((attendee) => attendee.qrIssued === false).map((attendee) => attendee.id);
  const standardColumns = [
    { label: "Name", field: "name" },
    { label: "Email", field: "email" },
    { label: "Ticket type", field: "ticketType" },
  ] as const;
  const columns = [
    ...standardColumns.filter(({ field }) => rows.some((row) => row[field] !== null))
      .map(({ label, field }) => ({ label, value: (row: Attendee) => row[field] })),
    ...new Set(rows.flatMap((row) => Object.keys(row.customFields))),
  ].map((column) => typeof column === "string"
    ? { label: column, value: (row: Attendee) => Object.hasOwn(row.customFields, column) ? row.customFields[column] : "" }
    : column);
  const title = eventQuery.data?.event.name ?? "Attendees";
  return <div className="page-enter">
    <PageHeader eyebrow="Event / guest list" title="Attendees" description={`${title} · private guest records and one-time QR credentials`} action={<Link to={`/admin/events/${eventId}`}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />Event overview</Button></Link>} />
    <EventTabs eventId={eventId} />
    <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2"><Badge tone="default">{attendees.data?.length ?? 0} shown</Badge><span className="text-xs text-muted-foreground">Up to 500 records per view</span></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={badgeReady.length === 0 || downloadingBulk || clearing} onClick={() => setArchive(badgeArchiveSelection(badgeReady))}>
          <FileArchive className="h-4 w-4" />Badges ZIP ({badgeReady.length})
        </Button>
        <Button size="sm" variant="destructive" disabled={clearDisabled} onClick={confirmClear}>
          <Trash2 className="h-4 w-4" />{clearing ? "Clearing attendees…" : "Clear attendees"}
        </Button>
        {savedImport.length === 0 && missingQrIds.length > 1 && <Button size="sm" variant="outline" disabled={issueQr.isPending || clearing} onClick={() => issueQr.mutate({ ids: missingQrIds, fromImport: false })}>Generate missing QR codes ({missingQrIds.length})</Button>}
        <Link to={`/admin/events/${eventId}/registration`}>
          <Button size="sm" variant="outline" className="gap-1.5">
            <Link2 className="h-4 w-4 text-primary" />
            Registration link & form
          </Button>
        </Link>
        <Button size="sm" variant="outline" onClick={() => { setShowBulk((value) => !value); setShowForm(false); }}><FilePlus2 className="h-4 w-4" />Import CSV or Excel</Button>
        <Button size="sm" onClick={() => { setShowForm((value) => !value); setShowBulk(false); }}><UserPlus className="h-4 w-4" />Add attendee</Button>
      </div>
    </div>
    {archive && <Card className="mb-4">
      <CardContent className="p-5">
        <form onSubmit={downloadBadgeArchive} className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="panel-title">Download badges ZIP</h2>
              <p className="mt-1 text-xs text-muted-foreground">{archive.attendees.length} attendees · one PDF per badge</p>
            </div>
            <button type="button" aria-label="Close badge ZIP settings" disabled={downloadingBulk || clearing} onClick={() => setArchive(null)} className="text-muted-foreground hover:text-foreground disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium">
              <span>First filename field</span>
              <select className="input-control" value={archive.primary} disabled={downloadingBulk || clearing} onChange={(event) => {
                const primary = event.currentTarget.value;
                setArchive({ ...archive, primary, secondary: archive.secondary === primary ? "" : archive.secondary });
              }}>
                {archive.options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium">
              <span>Second filename field (optional)</span>
              <select className="input-control" value={archive.secondary} disabled={downloadingBulk || clearing} onChange={(event) => setArchive({ ...archive, secondary: event.currentTarget.value })}>
                <option value="">None</option>
                {archive.options.filter(({ value }) => value !== archive.primary).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 break-all text-xs text-muted-foreground">Example filename <span className="ml-1 font-medium text-foreground">{archivePreview}</span></p>
            <Button type="submit" disabled={downloadingBulk || clearing}><FileArchive className="h-4 w-4" />{downloadingBulk ? "Preparing ZIP…" : "Download ZIP"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>}
    {showForm && <Card className="mb-4"><CardContent className="p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="panel-title">New attendee</h2><p className="mt-1 text-xs text-muted-foreground">A unique, private QR token will be generated once.</p></div><button aria-label="Close form" onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div><form className="space-y-3" onSubmit={submit}><div className="grid gap-3 md:grid-cols-4"><input className="input-control" required maxLength={160} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} /><input className="input-control" type="email" maxLength={320} placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} /><input className="input-control" maxLength={80} placeholder="Ticket type" value={ticketType} onChange={(e) => setTicketType(e.target.value)} /><Button disabled={addAttendee.isPending || clearing}>{addAttendee.isPending ? "Creating QR…" : "Create attendee & QR"}</Button></div>{customFields.map((field, index) => <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"><input className="input-control" maxLength={50} placeholder="Field name (e.g. Company)" aria-label={`Custom field ${index + 1} name`} value={field.key} onChange={(e) => setCustomFields((current) => current.map((item) => item.id === field.id ? { ...item, key: e.target.value } : item))} /><input className="input-control" maxLength={1000} placeholder="Field value" aria-label={`Custom field ${index + 1} value`} value={field.value} onChange={(e) => setCustomFields((current) => current.map((item) => item.id === field.id ? { ...item, value: e.target.value } : item))} /><button type="button" aria-label={`Remove custom field ${index + 1}`} onClick={() => setCustomFields((current) => current.filter((item) => item.id !== field.id))} className="grid h-10 w-10 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-rose-50 hover:text-destructive"><X className="h-4 w-4" /></button></div>)}<div className="flex flex-wrap items-center justify-between gap-2"><Button type="button" size="sm" variant="outline" disabled={customFields.length >= 30} onClick={() => setCustomFields((current) => [...current, { id: crypto.randomUUID(), key: "", value: "" }])}><Plus className="h-4 w-4" />Add custom field</Button><span className="text-[10px] text-muted-foreground">Custom fields can be selected in the badge designer.</span></div></form></CardContent></Card>}
    {showBulk && <Card className="mb-4">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="panel-title">Import attendees</h2>
            <p className="mt-1 text-xs text-muted-foreground">Choose a CSV or Excel file with column names in the first row. Excel imports use the first worksheet.</p>
          </div>
          <button type="button" aria-label="Close import" onClick={() => setShowBulk(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submitBulk} className="space-y-3">
          <input type="file" className="input-control" accept=".csv,.xlsx,.xls" aria-label="Attendee spreadsheet" disabled={readingFile || addBulk.isPending} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void selectAttendeeFile(file);
          }} />
          {readingFile && <p role="status" className="text-xs text-muted-foreground">Reading file…</p>}
          {bulkError && <p role="alert" className="text-xs text-destructive">{bulkError}</p>}
          {attendeeFile && <>
            <p className="text-xs text-muted-foreground">{attendeeFile.name} · {attendeeFile.attendees.length} attendees · Preview of up to 5 rows</p>
            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted"><tr>{attendeeFile.columns.map((column) => <th key={column} scope="col" className="whitespace-nowrap px-3 py-2">{column}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">{attendeeFile.preview.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column} className="max-w-64 break-words px-3 py-2">{value}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </>}
          <Button disabled={readingFile || addBulk.isPending || clearing || !attendeeFile}>{addBulk.isPending ? "Saving attendees…" : "Save attendees"}</Button>
        </form>
      </CardContent>
    </Card>}
    {savedImport.length > 0 && <Card className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm font-semibold">{savedImport.length} attendees saved from the file</p>
        <Button size="sm" disabled={issueQr.isPending || clearing} onClick={() => issueQr.mutate({ ids: savedImport.map((attendee) => attendee.id), fromImport: true })}>
          {issueQr.isPending ? "Generating QR codes…" : "Generate QR codes"}
        </Button>
      </CardContent>
    </Card>}
    {created && <div className="mb-4 rounded-2xl border border-primary/20 bg-blue-50/60 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><img src={created.qrDataUrl} alt={`QR code for ${created.attendee.name}`} className="h-28 w-28 rounded-xl border border-border bg-white p-2" /><div className="flex-1"><p className="label-caps text-primary">QR issued / {created.attendee.ticketType}</p><h3 className="mt-1 font-display text-xl font-semibold">{created.attendee.name}</h3><p className="mt-1 text-sm text-muted-foreground">The scanner credential is encrypted at rest; only its one-way hash is used for lookup.</p><div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted" href={created.qrDataUrl} download={`eventdesk-${attendeeFilename(created.attendee)}-qr.png`}><ArrowDownToLine className="h-4 w-4" />QR image only</a><Button size="sm" variant="outline" disabled={Boolean(downloadingBadgeId) || clearing} onClick={() => void downloadBadge(created.attendee)}><FileText className="h-4 w-4" />Download designed badge PDF</Button></div></div><button aria-label="Close QR result" onClick={() => setCreated(null)} className="self-start text-muted-foreground"><X className="h-4 w-4" /></button></div></div>}
    {bulkCreated && <Card className="mb-4"><CardContent className="p-4"><div className="mb-3 flex items-start justify-between gap-4"><div><p className="label-caps text-primary">Bulk QR issue complete</p><h2 className="mt-1 font-display text-lg font-semibold">{bulkCreated.count} QR codes ready</h2><p className="mt-1 text-xs text-muted-foreground">Choose QR image only or download each attendee’s saved badge design.</p></div><div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={downloadingBulk || clearing} onClick={() => setArchive(badgeArchiveSelection(bulkCreated.attendees.map(({ attendee }) => attendee)))}><FileArchive className="h-4 w-4" />Badges ZIP</Button><button aria-label="Close bulk QR results" onClick={() => setBulkCreated(null)} className="text-muted-foreground"><X className="h-4 w-4" /></button></div></div><div className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">{bulkCreated.attendees.map((item) => <div key={item.attendee.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-semibold">{item.attendee.name || Object.values(item.attendee.customFields).find(Boolean) || item.attendee.email || "Attendee"}</p><p className="text-[10px] text-muted-foreground">{item.attendee.ticketType}{item.attendee.email ? ` · ${item.attendee.email}` : ""}</p></div><div className="flex shrink-0 items-center gap-3"><a className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary" href={item.qrDataUrl} download={`eventdesk-${attendeeFilename(item.attendee)}-qr.png`}><ArrowDownToLine className="h-3.5 w-3.5" />QR only</a><button className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary disabled:opacity-50" disabled={Boolean(downloadingBadgeId) || clearing} onClick={() => void downloadBadge(item.attendee)}><FileText className="h-3.5 w-3.5" />Badge PDF</button></div></div>)}</div></CardContent></Card>}
    <Card><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input className="input-control pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search attendee data" /></label><select className="input-control sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All attendees</option><option value="pending">Not checked in</option><option value="checked-in">Checked in</option></select></div>
      {attendees.isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">Loading attendees…</p> : attendees.isError ? <p className="p-8 text-center text-sm text-destructive">Could not load attendee records.</p> : rows.length ? <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-muted/50"><tr>{[...columns.map(({ label }) => label), "Status", "Checked in", "Badge"].map((label, index) => <th key={index} scope="col" className="whitespace-nowrap px-5 py-3 text-[10px] font-semibold uppercase tracking-[.13em] text-muted-foreground">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{rows.map((attendee) => <tr key={attendee.id} className="hover:bg-muted/30">
            {columns.map(({ label, value }, index) => <td key={index} className="max-w-64 break-words px-5 py-3.5 text-xs" aria-label={label}>{value(attendee)}</td>)}
            <td className="whitespace-nowrap px-5 py-3.5">{attendee.checkedInAt ? <Badge tone="success"><Check className="mr-1 h-3 w-3" />Checked in</Badge> : <Badge tone="warning">Expected</Badge>}</td>
            <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[11px] text-muted-foreground">{attendee.checkedInAt ? new Date(attendee.checkedInAt).toLocaleString() : "—"}</td>
            <td className="whitespace-nowrap px-5 py-3.5">
              {attendee.qrIssued === false
                ? <Button size="sm" variant="outline" disabled={issueQr.isPending || clearing} onClick={() => issueQr.mutate({ ids: [attendee.id], fromImport: false })}>Generate QR</Button>
                : <Button size="sm" variant="outline" disabled={Boolean(downloadingBadgeId) || clearing} onClick={() => void downloadBadge(attendee)}><FileText className="h-3.5 w-3.5" />Badge PDF</Button>}
            </td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="flex flex-col items-center justify-center p-12 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><UsersRound className="h-6 w-6" /></div><h3 className="mt-4 font-display font-semibold">No attendees match this view</h3></div>}</CardContent></Card>
  </div>;
}
