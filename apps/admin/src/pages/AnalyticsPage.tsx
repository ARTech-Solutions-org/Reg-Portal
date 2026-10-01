import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CircleCheck, TimerReset, UsersRound, Share2, Check, Copy } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEventDashboard } from "@/hooks/useEventDashboard";
import { EventTabs, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export function AnalyticsPage() {
  const { eventId = "" } = useParams();
  const query = useEventDashboard(eventId);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  
  const handleShare = async () => {
    try {
      const res = await api(`/events/${eventId}/share-link`, { method: "POST" }) as { token: string };
      setShareUrl(`${window.location.origin}/share/${res.token}`);
    } catch (e) {
      console.error(e);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const event = query.data?.event;
  const summary = query.data?.summary;
  if (!event || !summary) return <Card><CardContent className="p-8 text-sm text-muted-foreground">{query.isLoading ? "Loading check-in analytics…" : "Event analytics are not available."}</CardContent></Card>;
  const rows = [{ label: "Registered attendees", value: summary.total, icon: UsersRound }, { label: "Checked in", value: summary.checkedIn, icon: CircleCheck }, { label: "Remaining", value: summary.remaining, icon: TimerReset }];
  return <div className="page-enter">
    <PageHeader 
      eyebrow="Analytics / event" 
      title="Check-in analytics" 
      description={`${event.name} · live attendance performance`} 
      action={
        <div className="flex gap-2">
          {!shareUrl ? (
            <Button variant="outline" size="sm" onClick={handleShare}><Share2 className="mr-2 h-4 w-4" />Share analytics</Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={copyLink}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          )}
          <Link to={`/admin/events/${eventId}`}><Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Event overview</Button></Link>
        </div>
      } 
    />
    <EventTabs eventId={eventId} />
    <div className="grid gap-4 md:grid-cols-3">{rows.map((row) => <Card key={row.label}><CardContent className="flex items-center gap-4 p-5"><div className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary"><row.icon className="h-5 w-5" /></div><div><p className="label-caps">{row.label}</p><p className="mt-1 font-display text-2xl font-semibold">{row.value}</p></div></CardContent></Card>)}</div>
    <Card className="mt-5"><CardHeader><CardTitle>Arrival rhythm</CardTitle><p className="mt-1 text-xs text-muted-foreground">Hourly counts over the trailing twelve-hour window.</p></CardHeader><CardContent><div className="h-[340px]">{summary.checkedIn > 0 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={summary.hourly} margin={{ top: 12, right: 18, bottom: 0, left: -12 }}><defs><linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3468dc" stopOpacity={0.22} /><stop offset="100%" stopColor="#3468dc" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf3" /><XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#7d8797" }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#7d8797" }} /><Tooltip /><Area type="monotone" dataKey="count" name="Check-ins" stroke="#3468dc" fill="url(#analyticsFill)" strokeWidth={2.5} /></AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">No check-ins have been recorded for this event.</div>}</div><p className="mt-3 text-[11px] text-muted-foreground">{summary.rate}% of registered guests are checked in. Counts refresh from the event stream.</p></CardContent></Card>
  </div>;
}
