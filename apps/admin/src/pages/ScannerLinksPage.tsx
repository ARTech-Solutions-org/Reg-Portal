import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, ExternalLink, Link2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  contractJson,
  scannerLinkCopyResponseSchema,
  scannerLinkInputSchema,
  scannerLinkIssueResponseSchema,
  scannerLinkListSchema,
  type ScannerLinkIssueResponse,
  type ScannerLinkListItem,
} from "@eventdesk/contracts";
import { apiContract, apiNoContent, ApiError } from "@/lib/api";
import { useEventDashboard } from "@/hooks/useEventDashboard";
import { EventTabs, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ScannerLinksPage() {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const eventQuery = useEventDashboard(eventId);
  const [label, setLabel] = useState("Front gate");
  const [hours, setHours] = useState(72);
  const [newLink, setNewLink] = useState<ScannerLinkIssueResponse | null>(null);

  const links = useQuery<ScannerLinkListItem[]>({
    queryKey: ["scanner-links", eventId],
    queryFn: () => apiContract(`/events/${eventId}/scanner-links`, scannerLinkListSchema),
  });
  const create = useMutation({
    mutationFn: () => apiContract(`/events/${eventId}/scanner-links`, scannerLinkIssueResponseSchema, {
      method: "POST",
      body: contractJson(scannerLinkInputSchema, { label, expiresInHours: hours }),
    }),
    onSuccess: async (value) => {
      setNewLink(value);
      await queryClient.invalidateQueries({ queryKey: ["scanner-links", eventId] });
      toast.success("Dedicated staff scanner link created.");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create scanner link."),
  });
  const copyExisting = useMutation({
    mutationFn: (linkId: string) => apiContract(
      `/events/${eventId}/scanner-links/${linkId}/copy`,
      scannerLinkCopyResponseSchema,
      { method: "POST" },
    ),
    onSuccess: ({ url }) => { void copy(url); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not retrieve this scanner URL."),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiNoContent(`/events/${eventId}/scanner-links/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scanner-links", eventId] }),
    onError: () => toast.error("Could not revoke scanner link."),
  });

  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate(); };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
      toast.success("Scanner URL copied.");
    } catch {
      toast.error("Clipboard access was blocked. Open the URL and copy it manually.");
    }
  };

  return <div className="page-enter">
    <PageHeader
      eyebrow="Event / staff access"
      title="Scanner links"
      description={`${eventQuery.data?.event.name ?? "Event"} · give each gate team a revocable check-in URL.`}
      action={<Link to={`/admin/events/${eventId}`}><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />Event overview</Button></Link>}
    />
    <EventTabs eventId={eventId} />
    <div className="grid gap-6 xl:grid-cols-[.85fr_1.25fr]">
      <Card className="h-fit">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Link2 className="h-5 w-5" /></div>
            <div><h2 className="panel-title">New gate link</h2><p className="text-xs text-muted-foreground">Event-scoped · time-limited · no organizer login for staff</p></div>
          </div>
          <form className="mt-5 space-y-3.5" onSubmit={submit}>
            <label className="block">
              <span className="label-caps mb-2 block">Staff label</span>
              <input className="input-control" value={label} maxLength={80} minLength={1} onChange={(e) => setLabel(e.target.value)} required placeholder="South entrance" />
            </label>
            <label className="block">
              <span className="label-caps mb-2 block">Link expires in</span>
              <select className="input-control" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                <option value={8}>8 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option><option value={720}>30 days</option>
              </select>
            </label>
            <Button className="w-full" disabled={create.isPending}>{create.isPending ? "Creating link…" : <>Create scanner URL <Plus className="h-4 w-4" /></>}</Button>
          </form>
          <div className="mt-5 rounded-xl bg-muted/70 p-3.5">
            <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="text-[11px] leading-5 text-muted-foreground">Give staff the dedicated scanner URL. It is their only access credential—no organizer username/password is required. Tokens are hashed for validation and encrypted for authorized copying; they are never stored in plaintext. Older hash-only links cannot be recovered.</p></div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="panel-title">Active and past links</h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">Copy the same active “Open scanner” URL for staff, or revoke it immediately. Older links issued before encrypted recovery cannot be copied.</p>
        {newLink && <Card className="mb-4 border-primary/25 bg-blue-50/40"><CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-primary"><Check className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{newLink.label} is ready</p>
              <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{new URL(newLink.url, window.location.origin).toString()}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void copy(newLink.url)}><Copy className="h-3.5 w-3.5" />Copy URL</Button>
                <a href={new URL(newLink.url, window.location.origin).toString()} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" />Open scanner</Button></a>
              </div>
            </div>
          </div>
        </CardContent></Card>}

        {links.isLoading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading staff links…</CardContent></Card>
          : links.data?.length ? <Card><CardContent className="divide-y divide-border p-0">
            {links.data.map((item) => {
              const expired = item.expiresAt ? new Date(item.expiresAt).getTime() < Date.now() : false;
              const revoked = Boolean(item.revokedAt);
              const copyUnavailable = !item.canCopy && !expired && !revoked;
              return <div key={item.id} className="flex flex-wrap items-center gap-3 p-4 sm:gap-4">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${revoked || expired ? "bg-muted text-muted-foreground" : "bg-emerald-50 text-emerald-700"}`}><Link2 className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{item.label}</p>
                    <Badge tone={revoked ? "danger" : expired ? "warning" : "success"}>{revoked ? "Revoked" : expired ? "Expired" : "Active"}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.expiresAt ? `Expires ${new Date(item.expiresAt).toLocaleString()}` : "No expiry"} · created {new Date(item.createdAt).toLocaleDateString()}</p>
                  {copyUnavailable && <p className="mt-1 text-[10px] leading-4 text-amber-800">This older link is hash-only, so its original URL cannot be recovered. Create a new link to get a copyable URL.</p>}
                </div>
                {!revoked && !expired && <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Copy URL for ${item.label}`}
                    title={item.canCopy ? `Copy URL for ${item.label}` : "This older link cannot be recovered."}
                    disabled={!item.canCopy || copyExisting.isPending}
                    onClick={() => copyExisting.mutate(item.id)}
                  ><Copy className="h-3.5 w-3.5" /><span className="hidden sm:inline">Copy link</span></Button>
                  <Button variant="ghost" size="icon" aria-label={`Revoke ${item.label}`} onClick={() => revoke.mutate(item.id)} disabled={revoke.isPending}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>}
              </div>;
            })}
          </CardContent></Card>
            : <Card><CardContent className="p-10 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Link2 className="h-5 w-5" /></div><h3 className="mt-4 font-display font-semibold">No staff links created</h3><p className="mt-1 text-xs text-muted-foreground">Create a link for each gate or staff team.</p></CardContent></Card>}
      </div>
    </div>
  </div>;
}
