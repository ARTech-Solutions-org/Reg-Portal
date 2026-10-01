import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderKanban, Plus, Sparkles, Ticket, UsersRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { contractJson, projectInputSchema, projectListSchema, projectSchema, type Project } from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const projects = useQuery<Project[]>({ queryKey: ["projects"], queryFn: () => apiContract("/projects", projectListSchema) });
  const createProject = useMutation({
    mutationFn: (projectName: string) => apiContract("/projects", projectSchema, { method: "POST", body: contractJson(projectInputSchema, { name: projectName }) }),
    onSuccess: async (project) => { await queryClient.invalidateQueries({ queryKey: ["projects"] }); setName(""); toast.success("Project workspace created."); navigate(`/admin/projects/${project.id}`); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create project."),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) createProject.mutate(name.trim()); };
  const totalEvents = projects.data?.reduce((count, project) => count + (project.eventCount ?? 0), 0) ?? 0;

  return <div className="page-enter space-y-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="label-caps text-primary">Operations / workspace</p><h1 className="mt-2 font-display text-3xl font-semibold tracking-[-.045em] md:text-4xl">Good events start here.</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">A clear view of your projects, events and the arrivals ahead.</p></div><div className="flex items-center gap-2 rounded-full border border-border bg-white px-3 py-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-emerald-500" />Workspace connected</div></div>

    <section className="grid gap-4 sm:grid-cols-3">
      {[{ label: "Projects", value: projects.data?.length ?? 0, icon: FolderKanban, detail: "Separate operations workspaces" }, { label: "Events", value: totalEvents, icon: Ticket, detail: "Ready for guest operations" }, { label: "Attendee data", value: "Isolated", icon: UsersRound, detail: "Private event-specific tables" }].map((metric) => <Card key={metric.label}><CardContent className="flex items-start justify-between p-5"><div><p className="label-caps">{metric.label}</p><p className="mt-3 font-display text-3xl font-semibold tracking-tight">{metric.value}</p><p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><metric.icon className="h-5 w-5" /></div></CardContent></Card>)}
    </section>

    <section className="grid gap-6 xl:grid-cols-[1.55fr_.75fr]">
      <div>
        <div className="mb-4 flex items-center justify-between"><div><h2 className="panel-title">Your projects</h2><p className="mt-1 text-xs text-muted-foreground">Each project receives its own isolated data schema.</p></div><span className="mono-label">{projects.data?.length ?? 0} workspaces</span></div>
        {projects.isLoading ? <Card><CardContent className="space-y-3 p-6"><div className="h-4 w-36 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded-xl bg-muted" /></CardContent></Card> : projects.isError ? <Card><CardContent className="p-6 text-sm text-destructive">Could not load projects. Check the connection and refresh.</CardContent></Card> : projects.data?.length ? <div className="grid gap-3 sm:grid-cols-2">{projects.data.map((project, index) => <Link key={project.id} to={`/admin/projects/${project.id}`} className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-lift"><CardContent className="p-5"><div className="flex items-start justify-between"><div className={`grid h-11 w-11 place-items-center rounded-xl ${index % 2 ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}><FolderKanban className="h-5 w-5" /></div><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div><h3 className="mt-5 font-display text-lg font-semibold">{project.name}</h3><p className="mt-1 text-xs text-muted-foreground">{project.eventCount ?? 0} events · Created {new Date(project.createdAt).toLocaleDateString()}</p><div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-[11px] font-medium text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Open workspace</div></CardContent></Card></Link>)}</div> : <Card><CardContent className="flex min-h-56 flex-col items-center justify-center p-8 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent text-primary"><FolderKanban className="h-6 w-6" /></div><h3 className="mt-4 font-display text-lg font-semibold">Your first project is one step away</h3><p className="mt-2 max-w-sm text-sm text-muted-foreground">Create a workspace to organize events, attendee data, staff links and check-in analytics.</p></CardContent></Card>}
      </div>

      <Card className="h-fit overflow-hidden"><div className="h-1.5 bg-primary" /><CardContent className="p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Plus className="h-5 w-5" /></div><div><h2 className="panel-title">New project</h2><p className="text-xs text-muted-foreground">Start an isolated workspace</p></div></div><form className="mt-5 space-y-3" onSubmit={submit}><label className="block"><span className="label-caps mb-2 block">Project name</span><input className="input-control" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} minLength={2} required placeholder="Annual summit" /></label><Button className="w-full" disabled={createProject.isPending || name.trim().length < 2}>{createProject.isPending ? "Provisioning workspace…" : <>Create project <ArrowRight className="h-4 w-4" /></>}</Button></form><div className="mt-5 rounded-xl bg-muted/70 p-3.5"><div className="flex items-start gap-2.5"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="text-[11px] leading-5 text-muted-foreground">Event attendee tables are provisioned automatically inside the project's private Neon schema.</p></div></div></CardContent></Card>
    </section>
  </div>;
}
