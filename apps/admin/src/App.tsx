import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
const ProjectPage = lazy(() => import("@/pages/ProjectPage").then((module) => ({ default: module.ProjectPage })));
const EventOverviewPage = lazy(() => import("@/pages/EventOverviewPage").then((module) => ({ default: module.EventOverviewPage })));
const AttendeesPage = lazy(() => import("@/pages/AttendeesPage").then((module) => ({ default: module.AttendeesPage })));
const ScannerLinksPage = lazy(() => import("@/pages/ScannerLinksPage").then((module) => ({ default: module.ScannerLinksPage })));
const ScannerBrandingPage = lazy(() => import("@/pages/ScannerBrandingPage").then((module) => ({ default: module.ScannerBrandingPage })));

const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const DesignerPage = lazy(() => import("@/pages/DesignerPage").then((module) => ({ default: module.DesignerPage })));
const PublicAnalyticsPage = lazy(() => import("@/pages/PublicAnalyticsPage").then((module) => ({ default: module.PublicAnalyticsPage })));
const EventBrandingPage = lazy(() => import("@/pages/EventBrandingPage").then((module) => ({ default: module.EventBrandingPage })));

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Opening your workspace…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function NotFound() { return <div className="grid min-h-screen place-items-center p-6 text-center"><div><p className="label-caps">404 / not found</p><h1 className="mt-3 font-display text-3xl font-semibold">This page isn't on the run sheet.</h1><a href="/admin" className="mt-4 inline-block text-sm font-semibold text-primary">Return to operations</a></div></div>; }

export default function App() {
  return <AuthProvider><Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading workspace tool…</div>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/share/:token" element={<PublicAnalyticsPage />} />
    <Route element={<Protected />}><Route element={<AppShell />}>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<DashboardPage />} />
      <Route path="/admin/projects/:projectId" element={<ProjectPage />} />
      <Route path="/admin/events/:eventId" element={<EventOverviewPage />} />
      <Route path="/admin/events/:eventId/event-branding" element={<EventBrandingPage />} />
      <Route path="/admin/events/:eventId/attendees" element={<AttendeesPage />} />
      <Route path="/admin/events/:eventId/analytics" element={<AnalyticsPage />} />
      <Route path="/admin/events/:eventId/links" element={<ScannerLinksPage />} />
      <Route path="/admin/events/:eventId/scanner-branding" element={<ScannerBrandingPage />} />
      <Route path="/admin/events/:eventId/designer" element={<DesignerPage />} />
    </Route></Route>
    <Route path="*" element={<NotFound />} />
  </Routes></Suspense></AuthProvider>;
}
