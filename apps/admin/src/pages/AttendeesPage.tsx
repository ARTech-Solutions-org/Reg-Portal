import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeft, Check, FilePlus2, FileText, Plus, Search, UserPlus, UsersRound, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { apiErrorResponseSchema, attendeeInputSchema, attendeeListSchema, bulkAttendeeInputSchema, bulkAttendeeResultSchema, contractJson, customFieldKeySchema, issuedAttendeeSchema, type Attendee, type AttendeeInput, type BulkAttendeeResult, type IssuedAttendee } from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { useEventDashboard } from "@/hooks/useEventDashboard";
import { EventTabs, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]!;
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") { row.push(field.trim()); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quote.");
  row.push(field.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function AttendeesPage() {
  const { eventId = "" } = useParams();
  const client = useQueryClient();
  const eventQuery = useEventDashboard(eventId);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [created, setCreated] = useState<IssuedAttendee | null>(null);
  const [bulkCreated, setBulkCreated] = useState<BulkAttendeeResult | null>(null);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ticketType, setTicketType] = useState("General");
  const [customFields, setCustomFields] = useState<Array<{ id: string; key: string; value: string }>>([]);
  const [downloadingBadgeId, setDownloadingBadgeId] = useState<string | null>(null);
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
    mutationFn: (values: AttendeeInput[]) => apiContract(`/events/${eventId}/attendees/bulk`, bulkAttendeeResultSchema, { method: "POST", body: contractJson(bulkAttendeeInputSchema, { attendees: values }) }),
    onSuccess: async (value) => { setBulkCreated(value); setBulkCsv(""); setBulkError(""); setShowBulk(false); await refreshRows(); toast.success(`${value.count} attendees and QR codes issued.`); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not import attendees."),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
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
  const submitBulk = (event: FormEvent) => {
    event.preventDefault();
    setBulkError("");
    try {
      const rows = parseCsv(bulkCsv.replace(/^\uFEFF/, ""));
      if (!rows.length) throw new Error("Paste attendee rows first.");
      const rawHeader = rows[0]!;
      const first = rawHeader.map((cell) => cell.trim().toLowerCase().replace(/[\s_-]+/g, ""));
      const hasHeader = first.includes("name");
      const findColumn = (label: string, accepted: string[]) => {
        const matches = first.map((header, index) => accepted.includes(header) ? index : -1).filter((index) => index >= 0);
        if (matches.length > 1) throw new Error(`The CSV has more than one ${label} column.`);
        return matches[0] ?? -1;
      };
      const nameIndex = hasHeader ? findColumn("name", ["name"]) : 0;
      const emailIndex = hasHeader ? findColumn("email", ["email"]) : 1;
      const ticketIndex = hasHeader ? findColumn("ticket type", ["tickettype"]) : 2;
      const dataRows = hasHeader ? rows.slice(1) : rows;
      if (!dataRows.length) throw new Error("The CSV has a header but no attendee rows.");
      if (dataRows.length > 500) throw new Error("Import is limited to 500 attendees at a time.");
      const reservedColumns = new Set([nameIndex, emailIndex, ticketIndex].filter((index) => index >= 0));
      const seenCustomKeys = new Set<string>();
      const customColumns = hasHeader ? rawHeader.map((header, index) => {
        if (reservedColumns.has(index)) return null;
        const label = header.trim();
        if (!label) {
          if (dataRows.some((row) => (row[index] ?? "").trim())) throw new Error("Every non-empty custom CSV column needs a header name.");
          return null;
        }
        const key = customFieldKeySchema.parse(label);
        if (seenCustomKeys.has(key.toLowerCase())) throw new Error(`The custom CSV field “${key}” appears more than once.`);
        seenCustomKeys.add(key.toLowerCase());
        return { index, key };
      }).filter((column): column is { index: number; key: string } => column !== null) : [];
      const values = dataRows.map((cells) => {
        const custom: Record<string, string> = {};
        for (const column of customColumns) custom[column.key] = cells[column.index] ?? "";
        return {
          name: cells[nameIndex] ?? "",
          email: emailIndex >= 0 ? cells[emailIndex] ?? "" : "",
          ticketType: ticketIndex >= 0 ? cells[ticketIndex] ?? "General" : "General",
          customFields: custom,
        };
      });
      if (values.some((row) => !row.name.trim())) throw new Error("Every attendee row needs a name.");
      const validated = bulkAttendeeInputSchema.safeParse({ attendees: values });
      if (!validated.success) throw new Error(validated.error.issues[0]?.message ?? "Check the attendee rows and custom field names.");
      addBulk.mutate(validated.data.attendees);
    } catch (error) { setBulkError(error instanceof Error ? error.message : "Check the CSV format and try again."); }
  };
  const downloadBadge = async (attendee: Pick<Attendee, "id" | "name">) => {
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
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const slug = attendee.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "attendee";
      anchor.href = url;
      anchor.download = `eventdesk-${slug}-badge.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_500);
      toast.success(`Designed badge downloaded for ${attendee.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the designed badge.");
    } finally {
      setDownloadingBadgeId(null);
    }
  };
  const downloadBulkBadges = async (attendeesToDownload: Pick<Attendee, "id">[]) => {
    setDownloadingBulk(true);
    try {
      const response = await fetch(`/api/events/${eventId}/badges/bulk.pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/pdf" },
        body: JSON.stringify({ attendeeIds: attendeesToDownload.map((a) => a.id) }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const parsed = apiErrorResponseSchema.safeParse(payload);
        throw new Error(parsed.success ? parsed.data.error : `Bulk badge download failed (${response.status}).`);
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("The server did not return a badge PDF.");
      const blob = await response.blob();
      if (!blob.size) throw new Error("The badge PDF was empty.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `eventdesk-bulk-badges.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_500);
      toast.success(`Downloaded bulk badges PDF for ${attendeesToDownload.length} attendees.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not download the bulk badges.");
    } finally {
      setDownloadingBulk(false);
    }
  };
  const title = eventQuery.data?.event.name ?? "Attendees";
  return <div className="page-enter">
    <PageHeader eyebrow="Event / guest list" title="Attendees" description={`${title} · private guest records and one-time QR credentials`} action={<Link to={`/admin/events/${eventId}`}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />Event overview</Button></Link>} />
    <EventTabs eventId={eventId} />
    <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2"><Badge tone="default">{attendees.data?.length ?? 0} shown</Badge><span className="text-xs text-muted-foreground">Up to 500 records per view</span></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => { setShowBulk((value) => !value); setShowForm(false); }}><FilePlus2 className="h-4 w-4" />Import CSV</Button>
        <Button size="sm" onClick={() => { setShowForm((value) => !value); setShowBulk(false); }}><UserPlus className="h-4 w-4" />Add attendee</Button>
      </div>
    </div>
    {showForm && <Card className="mb-4"><CardContent className="p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="panel-title">New attendee</h2><p className="mt-1 text-xs text-muted-foreground">A unique, private QR token will be generated once.</p></div><button aria-label="Close form" onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div><form className="space-y-3" onSubmit={submit}><div className="grid gap-3 md:grid-cols-4"><input className="input-control" required maxLength={160} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} /><input className="input-control" type="email" maxLength={320} placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} /><input className="input-control" maxLength={80} placeholder="Ticket type" value={ticketType} onChange={(e) => setTicketType(e.target.value)} /><Button disabled={addAttendee.isPending}>{addAttendee.isPending ? "Creating QR…" : "Create attendee & QR"}</Button></div>{customFields.map((field, index) => <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"><input className="input-control" maxLength={50} placeholder="Field name (e.g. Company)" aria-label={`Custom field ${index + 1} name`} value={field.key} onChange={(e) => setCustomFields((current) => current.map((item) => item.id === field.id ? { ...item, key: e.target.value } : item))} /><input className="input-control" maxLength={1000} placeholder="Field value" aria-label={`Custom field ${index + 1} value`} value={field.value} onChange={(e) => setCustomFields((current) => current.map((item) => item.id === field.id ? { ...item, value: e.target.value } : item))} /><button type="button" aria-label={`Remove custom field ${index + 1}`} onClick={() => setCustomFields((current) => current.filter((item) => item.id !== field.id))} className="grid h-10 w-10 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-rose-50 hover:text-destructive"><X className="h-4 w-4" /></button></div>)}<div className="flex flex-wrap items-center justify-between gap-2"><Button type="button" size="sm" variant="outline" disabled={customFields.length >= 30} onClick={() => setCustomFields((current) => [...current, { id: crypto.randomUUID(), key: "", value: "" }])}><Plus className="h-4 w-4" />Add custom field</Button><span className="text-[10px] text-muted-foreground">Custom fields can be selected in the badge designer.</span></div></form></CardContent></Card>}
    {showBulk && <Card className="mb-4"><CardContent className="p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="panel-title">Import attendees</h2><p className="mt-1 text-xs text-muted-foreground">Paste CSV with <code>name,email,ticketType</code> and any custom field columns. Header is optional; maximum 500 rows and 30 custom fields.</p></div><button aria-label="Close import" onClick={() => setShowBulk(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div><form onSubmit={submitBulk} className="space-y-3"><textarea className="input-control min-h-36 resize-y font-mono text-xs" value={bulkCsv} onChange={(e) => setBulkCsv(e.target.value)} placeholder={'name,email,ticketType,Company,Meal\nAvery Stone,avery@example.com,General,Northstar,Vegetarian\nMorgan Lee,,VIP,Contoso,Standard'} aria-label="Attendee CSV" />{bulkError && <p role="alert" className="text-xs text-destructive">{bulkError}</p>}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-muted-foreground">QR credentials are unique, encrypted at rest, and are not encoded with attendee details.</p><Button disabled={addBulk.isPending || !bulkCsv.trim()}>{addBulk.isPending ? "Issuing attendee QR codes…" : "Import & issue QR codes"}</Button></div></form></CardContent></Card>}
    {created && <div className="mb-4 rounded-2xl border border-primary/20 bg-blue-50/60 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><img src={created.qrDataUrl} alt={`QR code for ${created.attendee.name}`} className="h-28 w-28 rounded-xl border border-border bg-white p-2" /><div className="flex-1"><p className="label-caps text-primary">QR issued / {created.attendee.ticketType}</p><h3 className="mt-1 font-display text-xl font-semibold">{created.attendee.name}</h3><p className="mt-1 text-sm text-muted-foreground">The scanner credential is encrypted at rest; only its one-way hash is used for lookup.</p><div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted" href={created.qrDataUrl} download={`eventdesk-${created.attendee.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`}><ArrowDownToLine className="h-4 w-4" />QR image only</a><Button size="sm" variant="outline" disabled={Boolean(downloadingBadgeId)} onClick={() => void downloadBadge(created.attendee)}><FileText className="h-4 w-4" />Download designed badge PDF</Button></div></div><button aria-label="Close QR result" onClick={() => setCreated(null)} className="self-start text-muted-foreground"><X className="h-4 w-4" /></button></div></div>}
    {bulkCreated && <Card className="mb-4"><CardContent className="p-4"><div className="mb-3 flex items-start justify-between gap-4"><div><p className="label-caps text-primary">Bulk QR issue complete</p><h2 className="mt-1 font-display text-lg font-semibold">{bulkCreated.count} attendees added</h2><p className="mt-1 text-xs text-muted-foreground">Choose QR image only or download each attendee’s saved badge design.</p></div><div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={downloadingBulk} onClick={() => void downloadBulkBadges(bulkCreated.attendees.map(a => a.attendee))}><FileText className="h-4 w-4" />{downloadingBulk ? "Generating..." : "Download All Badges PDF"}</Button><button aria-label="Close bulk QR results" onClick={() => setBulkCreated(null)} className="text-muted-foreground"><X className="h-4 w-4" /></button></div></div><div className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">{bulkCreated.attendees.map((item) => <div key={item.attendee.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-semibold">{item.attendee.name}</p><p className="text-[10px] text-muted-foreground">{item.attendee.ticketType}{item.attendee.email ? ` · ${item.attendee.email}` : ""}</p></div><div className="flex shrink-0 items-center gap-3"><a className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary" href={item.qrDataUrl} download={`eventdesk-${item.attendee.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`}><ArrowDownToLine className="h-3.5 w-3.5" />QR only</a><button className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary disabled:opacity-50" disabled={Boolean(downloadingBadgeId)} onClick={() => void downloadBadge(item.attendee)}><FileText className="h-3.5 w-3.5" />Badge PDF</button></div></div>)}</div></CardContent></Card>}
    <Card><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input className="input-control pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" /></label><select className="input-control sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All attendees</option><option value="pending">Not checked in</option><option value="checked-in">Checked in</option></select></div>
      {attendees.isLoading ? <p className="p-8 text-center text-sm text-muted-foreground">Loading attendees…</p> : attendees.isError ? <p className="p-8 text-center text-sm text-destructive">Could not load attendee records.</p> : attendees.data?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-muted/50"><tr>{["Guest", "Ticket", "Status", "Checked in", "Badge"].map((label) => <th key={label} className="px-5 py-3 text-[10px] font-semibold uppercase tracking-[.13em] text-muted-foreground">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{attendees.data.map((attendee) => <tr key={attendee.id} className="hover:bg-muted/30"><td className="px-5 py-3.5"><div className="text-sm font-semibold">{attendee.name}</div><div className="mt-1 text-xs text-muted-foreground">{attendee.email || "No email provided"}</div></td><td className="px-5 py-3.5 text-xs">{attendee.ticketType}</td><td className="px-5 py-3.5">{attendee.checkedInAt ? <Badge tone="success"><Check className="mr-1 h-3 w-3" />Checked in</Badge> : <Badge tone="warning">Expected</Badge>}</td><td className="px-5 py-3.5 font-mono text-[11px] text-muted-foreground">{attendee.checkedInAt ? new Date(attendee.checkedInAt).toLocaleString() : "—"}</td><td className="px-5 py-3.5"><Button size="sm" variant="outline" disabled={Boolean(downloadingBadgeId)} onClick={() => void downloadBadge(attendee)}><FileText className="h-3.5 w-3.5" />Badge PDF</Button></td></tr>)}</tbody></table></div> : <div className="flex flex-col items-center justify-center p-12 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><UsersRound className="h-6 w-6" /></div><h3 className="mt-4 font-display font-semibold">No attendees match this view</h3><p className="mt-1 text-xs text-muted-foreground">Add a guest to generate the first event QR code.</p></div>}</CardContent></Card>
  </div>;
}
