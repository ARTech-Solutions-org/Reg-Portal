import { useState, useEffect, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Plus,
  QrCode,
  Smartphone,
  Trash2,
  ChevronUp,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import QRCode from "qrcode";
import {
  contractJson,
  customFieldKeySchema,
  defaultEventRegistrationSettings,
  eventRegistrationSettingsResponseSchema,
  eventRegistrationSettingsSchema,
  type EventRegistrationSettings,
  type RegistrationField,
  type RegistrationFieldType,
} from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { useEventDashboard } from "@/hooks/useEventDashboard";
import { EventTabs, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PRESET_FIELDS: Array<{ label: string; key: string; type: RegistrationFieldType; placeholder: string }> = [
  { label: "Phone Number", key: "phone_number", type: "phone", placeholder: "+1 (555) 000-0000" },
  { label: "Company / Organization", key: "company", type: "text", placeholder: "Acme Corp" },
  { label: "Job Title", key: "job_title", type: "text", placeholder: "Software Engineer" },
  { label: "City", key: "city", type: "text", placeholder: "New York / London" },
  { label: "Notes / Special Requests", key: "notes", type: "textarea", placeholder: "Any specific requirements or dietary needs..." },
];

export function RegistrationSettingsPage() {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const eventQuery = useEventDashboard(eventId);

  const [settings, setSettings] = useState<EventRegistrationSettings>(defaultEventRegistrationSettings);
  const [copied, setCopied] = useState(false);
  const [linkQrDataUrl, setLinkQrDataUrl] = useState<string>("");
  const [showQrModal, setShowQrModal] = useState(false);

  // Field editor state for adding new field
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<RegistrationFieldType>("text");
  const [newRequired, setNewRequired] = useState(false);
  const [newPlaceholder, setNewPlaceholder] = useState("");
  const [newOptionsText, setNewOptionsText] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/register/${eventId}` : `/register/${eventId}`;

  const query = useQuery({
    queryKey: ["registration-settings", eventId],
    queryFn: () => apiContract(`/events/${eventId}/registration-settings`, eventRegistrationSettingsResponseSchema),
    enabled: Boolean(eventId),
  });

  useEffect(() => {
    if (query.data?.settings) {
      setSettings(query.data.settings);
    }
  }, [query.data]);

  useEffect(() => {
    if (publicUrl) {
      void QRCode.toDataURL(publicUrl, { width: 300, margin: 1, color: { dark: "#132035", light: "#FFFFFF" } }).then(setLinkQrDataUrl);
    }
  }, [publicUrl]);

  const saveMutation = useMutation({
    mutationFn: (values: EventRegistrationSettings) =>
      apiContract(`/events/${eventId}/registration-settings`, eventRegistrationSettingsResponseSchema, {
        method: "PUT",
        body: contractJson(eventRegistrationSettingsSchema, values),
      }),
    onSuccess: (data) => {
      setSettings(data.settings);
      void queryClient.invalidateQueries({ queryKey: ["registration-settings", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["attendee-fields", eventId] });
      toast.success("Registration settings saved successfully.");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not save settings."),
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success("Registration link copied to clipboard!");
    } catch {
      toast.error("Clipboard blocked. Please copy the URL manually.");
    }
  };

  const handleLabelChange = (val: string) => {
    setNewLabel(val);
    if (!newKey || newKey.startsWith("field_") || newKey === slugify(newLabel)) {
      setNewKey(slugify(val));
    }
  };

  const slugify = (text: string) => {
    const slug = text
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "_")
      .slice(0, 30);
    return slug ? (slug.match(/^[a-z]/) ? slug : `field_${slug}`) : "";
  };

  const addCustomField = (e: FormEvent) => {
    e.preventDefault();
    try {
      const trimmedLabel = newLabel.trim();
      if (!trimmedLabel) throw new Error("Please enter a field label.");
      const validKey = customFieldKeySchema.parse(newKey.trim() || `field_${Date.now()}`);

      if (settings.fields.some((f) => f.key.toLowerCase() === validKey.toLowerCase())) {
        throw new Error(`A field with key "${validKey}" already exists.`);
      }

      const options = newType === "select"
        ? newOptionsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
        : [];

      if (newType === "select" && options.length === 0) {
        throw new Error("Select dropdown requires at least one option.");
      }

      const field: RegistrationField = {
        id: `f_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        key: validKey,
        label: trimmedLabel,
        type: newType,
        required: newRequired,
        placeholder: newPlaceholder.trim(),
        options,
      };

      const updatedFields = [...settings.fields, field];
      setSettings({ ...settings, fields: updatedFields });
      setNewLabel("");
      setNewKey("");
      setNewType("text");
      setNewRequired(false);
      setNewPlaceholder("");
      setNewOptionsText("");
      setShowAddForm(false);
      toast.success(`Field "${trimmedLabel}" added.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid field details.");
    }
  };

  const addPresetField = (preset: typeof PRESET_FIELDS[0]) => {
    if (settings.fields.some((f) => f.key.toLowerCase() === preset.key.toLowerCase())) {
      toast.info(`Field "${preset.label}" is already on the form.`);
      return;
    }
    const field: RegistrationField = {
      id: `f_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      key: preset.key,
      label: preset.label,
      type: preset.type,
      required: false,
      placeholder: preset.placeholder,
      options: [],
    };
    setSettings({ ...settings, fields: [...settings.fields, field] });
    toast.success(`Added ${preset.label} to the form.`);
  };

  const removeField = (index: number) => {
    const updated = settings.fields.filter((_, i) => i !== index);
    setSettings({ ...settings, fields: updated });
  };

  const moveField = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= settings.fields.length) return;
    const list = [...settings.fields];
    const [moved] = list.splice(index, 1);
    list.splice(targetIndex, 0, moved!);
    setSettings({ ...settings, fields: list });
  };

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  return (
    <div className="page-enter pb-16">
      <PageHeader
        eyebrow="Event / public access"
        title="Registration link & form"
        description={`${eventQuery.data?.event.name ?? "Event"} · Customize the registration form, share the link, and choose whether to display the QR code.`}
        action={
          <div className="flex items-center gap-2">
            <Link to={`/admin/events/${eventId}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4" />
                Event overview
              </Button>
            </Link>
            <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        }
      />
      <EventTabs eventId={eventId} />

      {/* Hero Registration Link Card */}
      <Card className="mb-6 overflow-hidden border-primary/20 bg-gradient-to-r from-primary/[0.04] via-accent/30 to-background">
        <CardContent className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="label-caps text-primary">Public attendee registration link</span>
              </div>
              <h2 className="font-display text-xl font-semibold tracking-tight">Share this link with attendees</h2>
              <p className="max-w-xl text-xs text-muted-foreground leading-relaxed">
                Attendees can open this link on mobile or desktop to submit their details. Data is recorded instantly into your attendees list.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-foreground/80 bg-background/80 border border-border rounded-xl px-3.5 py-2 select-all">
                <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate max-w-[280px] sm:max-w-md">{publicUrl}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={copyLink} variant={copied ? "default" : "outline"} className="gap-2">
                {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied!" : "Copy link"}
              </Button>
              <Button variant="outline" onClick={() => setShowQrModal(true)} className="gap-2">
                <QrCode className="h-4 w-4" />
                QR code
              </Button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="secondary" className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Open page
                </Button>
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid: Form Builder & Settings + Mobile Preview */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          {/* QR Code Visibility & Registration Options */}
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="panel-title">QR Code & Registration Controls</h3>
                  <p className="text-xs text-muted-foreground">Control attendee QR visibility, submission limits, and gate scan modes</p>
                </div>
              </div>

              {/* Show QR Code Option */}
              <div className="rounded-xl border border-border bg-background p-4.5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        Display QR code to attendee upon registration
                      </span>
                      {settings.showQrCode ? (
                        <Badge tone="success" className="border border-emerald-500/40 text-[10px]">
                          <Eye className="h-3 w-3 mr-1" /> Enabled
                        </Badge>
                      ) : (
                        <Badge tone="warning" className="border border-amber-500/40 text-[10px]">
                          <EyeOff className="h-3 w-3 mr-1" /> Hidden
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      When enabled: The QR code is displayed immediately on the confirmation screen for attendees to save or screenshot.<br />
                      When disabled: Only a confirmation receipt message is shown without revealing the entrance QR code.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.showQrCode}
                    onClick={() => setSettings({ ...settings, showQrCode: !settings.showQrCode })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                      settings.showQrCode ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.showQrCode ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Registration Open/Closed Toggle */}
              <div className="rounded-xl border border-border bg-background p-4.5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">Registration Status (Open / Closed)</span>
                      {settings.isOpen ? (
                        <Badge tone="success" className="border border-emerald-500/40 text-[10px]">
                          Open
                        </Badge>
                      ) : (
                        <Badge tone="danger" className="border border-destructive/40 text-[10px]">
                          Closed
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Temporarily stop accepting submissions when capacity is reached.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.isOpen}
                    onClick={() => setSettings({ ...settings, isOpen: !settings.isOpen })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                      settings.isOpen ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        settings.isOpen ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Max Registrations Per Device */}
              <div className="rounded-xl border border-border bg-background p-4.5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="text-sm font-semibold text-foreground block">
                      Maximum Submissions Per Device
                    </span>
                    <p className="text-xs text-muted-foreground">
                      How many registrations a single device or browser can submit (protects against duplicate submissions).
                    </p>
                  </div>
                  <select
                    className="input-control sm:w-48 h-10 text-xs"
                    value={settings.maxRegistrationsPerDevice}
                    onChange={(e) => setSettings({ ...settings, maxRegistrationsPerDevice: Number(e.target.value) })}
                  >
                    <option value={1}>1 submission (Single)</option>
                    <option value={2}>2 submissions</option>
                    <option value={3}>3 submissions</option>
                    <option value={5}>5 submissions</option>
                    <option value={10}>10 submissions</option>
                    <option value={0}>Unlimited</option>
                  </select>
                </div>
              </div>

              {/* Max Scans Per Attendee */}
              <div className="rounded-xl border border-border bg-background p-4.5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="text-sm font-semibold text-foreground block">
                      Maximum QR Scans Per Attendee
                    </span>
                    <p className="text-xs text-muted-foreground">
                      Maximum number of times an attendee QR code can be scanned at the entrance gate.
                    </p>
                  </div>
                  <select
                    className="input-control sm:w-48 h-10 text-xs"
                    value={settings.maxScansPerAttendee}
                    onChange={(e) => setSettings({ ...settings, maxScansPerAttendee: Number(e.target.value) })}
                  >
                    <option value={1}>1 scan (Entrance only)</option>
                    <option value={2}>2 scans (Entrance & Exit)</option>
                    <option value={3}>3 scans</option>
                    <option value={4}>4 scans</option>
                    <option value={5}>5 scans</option>
                    <option value={10}>10 scans</option>
                    <option value={0}>Unlimited</option>
                  </select>
                </div>
              </div>

              {/* Scan Mode (Attendance Only VS Attendance & Departure) */}
              <div className="rounded-xl border border-border bg-background p-4.5 space-y-3">
                <div className="space-y-0.5">
                  <span className="text-sm font-semibold text-foreground block">
                    Gate Scanner Mode
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Choose whether gate staff only record arrival or track both arrival and departure.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, scanMode: "checkin_only" })}
                    className={`flex flex-col gap-1 rounded-xl border p-3.5 text-start transition-all ${
                      settings.scanMode === "checkin_only"
                        ? "border-primary bg-primary/[0.04] ring-2 ring-primary/20"
                        : "border-border hover:border-foreground/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">Check-in Only (Entrance)</span>
                      {settings.scanMode === "checkin_only" && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      QR scans validate and record guest arrival for entrance only.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, scanMode: "checkin_checkout" })}
                    className={`flex flex-col gap-1 rounded-xl border p-3.5 text-start transition-all ${
                      settings.scanMode === "checkin_checkout"
                        ? "border-primary bg-primary/[0.04] ring-2 ring-primary/20"
                        : "border-border hover:border-foreground/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">Check-in & Check-out (Entrance & Exit)</span>
                      {settings.scanMode === "checkin_checkout" && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Tracks both entry and exit (auto-toggles between in and out) to monitor live venue occupancy.
                    </p>
                  </button>
                </div>
              </div>

              {/* Custom Messages */}
              <div className="space-y-4 pt-2 border-t border-border">
                <label className="block">
                  <span className="label-caps mb-1.5 block">Registration Form Title (Optional)</span>
                  <input
                    className="input-control"
                    value={settings.title}
                    onChange={(e) => setSettings({ ...settings, title: e.target.value })}
                    placeholder={eventQuery.data?.event.name ?? "Registration Form"}
                  />
                </label>

                <label className="block">
                  <span className="label-caps mb-1.5 block">Welcome Message / Event Description</span>
                  <textarea
                    rows={2}
                    className="w-full rounded-xl border border-input bg-white p-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/10"
                    value={settings.description}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                    placeholder="Welcome! Please complete the form below to register for the event."
                  />
                </label>

                <label className="block">
                  <span className="label-caps mb-1.5 block">Success Message (Shown after submission)</span>
                  <input
                    className="input-control"
                    value={settings.successMessage}
                    onChange={(e) => setSettings({ ...settings, successMessage: e.target.value })}
                    placeholder="Your registration was successful! We look forward to seeing you at the event."
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Form Fields Builder */}
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="panel-title">Registration Form Fields</h3>
                  <p className="text-xs text-muted-foreground">Add and configure custom fields for attendees to complete</p>
                </div>
                <Button size="sm" onClick={() => setShowAddForm(true)} className="gap-1.5 self-start sm:self-auto">
                  <Plus className="h-4 w-4" />
                  Add Custom Field
                </Button>
              </div>

              {/* Quick Preset Buttons */}
              <div className="rounded-xl bg-accent/40 border border-accent p-3.5 space-y-2">
                <span className="text-[11px] font-semibold text-primary flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Quick Presets (Click to add):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_FIELDS.map((preset) => (
                    <Button
                      key={preset.key}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs bg-white hover:bg-primary/5"
                      onClick={() => addPresetField(preset)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Standard Base Fields Notice */}
              <div className="rounded-xl border border-dashed border-border p-3.5 bg-muted/30">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Full Name</span>
                  <Badge tone="neutral" className="text-[10px]">Required Core Field</Badge>
                </div>
              </div>

              {/* Custom Fields List */}
              <div className="space-y-3">
                {settings.fields.length === 0 ? (
                  <div className="p-8 text-center border rounded-xl border-dashed border-border">
                    <p className="text-sm font-medium text-muted-foreground">No custom fields added yet</p>
                    <p className="text-xs text-muted-foreground/80 mt-1">
                      Click "Add Custom Field" or choose from the quick presets above
                    </p>
                  </div>
                ) : (
                  settings.fields.map((field, idx) => (
                    <div
                      key={field.id}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5 transition-all hover:border-primary/40 hover:shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex flex-col gap-1 text-muted-foreground">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveField(idx, "up")}
                            className="p-0.5 hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === settings.fields.length - 1}
                            onClick={() => moveField(idx, "down")}
                            className="p-0.5 hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate text-foreground">{field.label}</span>
                            {field.required && (
                              <span className="text-destructive font-bold text-xs" title="Required">*</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                            <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">{field.key}</span>
                            <span>•</span>
                            <span className="capitalize">{field.type}</span>
                            {field.options && field.options.length > 0 && (
                              <span>• {field.options.length} options</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {field.required ? (
                          <Badge tone="default" className="text-[10px] border border-primary/30 text-primary">Required</Badge>
                        ) : (
                          <Badge tone="neutral" className="text-[10px] text-muted-foreground">Optional</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeField(idx)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add Field Modal / Form */}
              {showAddForm && (
                <div className="rounded-xl border border-primary/30 bg-primary/[0.02] p-4.5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-foreground">New Field Configuration</h4>
                    <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>Cancel</Button>
                  </div>

                  <form onSubmit={addCustomField} className="space-y-3.5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="label-caps mb-1.5 block">Field Label *</span>
                        <input
                          className="input-control"
                          value={newLabel}
                          onChange={(e) => handleLabelChange(e.target.value)}
                          placeholder="e.g. Phone Number or Company Name"
                          required
                          autoFocus
                        />
                      </label>

                      <label className="block">
                        <span className="label-caps mb-1.5 block">Field Identifier (Key) *</span>
                        <input
                          className="input-control font-mono text-xs"
                          value={newKey}
                          onChange={(e) => setNewKey(e.target.value)}
                          placeholder="phone_number"
                          required
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="label-caps mb-1.5 block">Field Type</span>
                        <select
                          className="input-control"
                          value={newType}
                          onChange={(e) => setNewType(e.target.value as RegistrationFieldType)}
                        >
                          <option value="text">Short Text</option>
                          <option value="phone">Phone Number</option>
                          <option value="email">Email Address</option>
                          <option value="number">Number</option>
                          <option value="select">Dropdown (Select)</option>
                          <option value="textarea">Paragraph / Notes (Textarea)</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="label-caps mb-1.5 block">Placeholder Text</span>
                        <input
                          className="input-control"
                          value={newPlaceholder}
                          onChange={(e) => setNewPlaceholder(e.target.value)}
                          placeholder="e.g. Enter your company name..."
                        />
                      </label>
                    </div>

                    {newType === "select" && (
                      <label className="block">
                        <span className="label-caps mb-1.5 block">Options (separate by comma or newline) *</span>
                        <textarea
                          rows={2}
                          className="w-full rounded-xl border border-input bg-white p-2.5 text-xs text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                          value={newOptionsText}
                          onChange={(e) => setNewOptionsText(e.target.value)}
                          placeholder="VIP, General, Student, Speaker"
                          required
                        />
                      </label>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="newFieldRequired"
                        checked={newRequired}
                        onChange={(e) => setNewRequired(e.target.checked)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                      />
                      <label htmlFor="newFieldRequired" className="text-xs font-medium cursor-pointer text-foreground">
                        Mark this field as required
                      </label>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm">
                        Add Field
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live Mobile Preview Side */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-primary" />
              Live attendee preview
            </span>
            <Badge tone="neutral" className="text-[10px]">
              {settings.showQrCode ? "QR: On" : "QR: Off"}
            </Badge>
          </div>

          <div className="mx-auto max-w-[360px] rounded-[32px] border-4 border-foreground/10 bg-card p-4 shadow-xl">
            <div className="mx-auto mb-4 h-4 w-28 rounded-full bg-muted/80" />
            
            <div className="space-y-4 pb-2">
              <div className="text-center space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Event Registration</span>
                <h4 className="font-display text-base font-semibold text-foreground">
                  {settings.title.trim() || eventQuery.data?.event.name || "Event Title"}
                </h4>
                {settings.description && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{settings.description}</p>
                )}
              </div>

              <div className="space-y-2.5 pt-2">
                <div>
                  <span className="text-[10px] font-semibold text-foreground block mb-1">Full Name *</span>
                  <div className="h-8 rounded-lg border border-input bg-muted/20 px-2.5 flex items-center text-[11px] text-muted-foreground">
                    John Doe
                  </div>
                </div>

                {settings.fields.map((f) => (
                  <div key={f.id}>
                    <span className="text-[10px] font-semibold text-foreground block mb-1">
                      {f.label} {f.required && <span className="text-destructive">*</span>}
                    </span>
                    <div className="h-8 rounded-lg border border-input bg-muted/20 px-2.5 flex items-center text-[11px] text-muted-foreground">
                      {f.placeholder || `Enter ${f.label}...`}
                    </div>
                  </div>
                ))}

                <div className="pt-2">
                  <div className="h-9 w-full rounded-lg bg-primary text-primary-foreground font-semibold text-xs flex items-center justify-center shadow-sm">
                    Submit Registration
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-dashed border-border p-3 text-center bg-muted/20">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">Post-Registration Preview (Result Screen)</p>
                {settings.showQrCode ? (
                  <div className="mt-2 flex flex-col items-center">
                    <div className="h-16 w-16 bg-foreground/10 rounded-lg flex items-center justify-center text-foreground">
                      <QrCode className="h-10 w-10 text-primary" />
                    </div>
                    <span className="text-[10px] font-medium text-emerald-600 mt-1">Entrance QR code will be displayed</span>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col items-center">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    <span className="text-[10px] font-medium text-muted-foreground mt-1">Confirmation receipt only (no QR code)</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* QR Code Modal for Registration Link */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl border border-border space-y-4 text-center">
            <h3 className="font-display text-lg font-semibold text-foreground">Registration Link QR Code</h3>
            <p className="text-xs text-muted-foreground">Scan with any smartphone camera to open the registration page directly</p>
            {linkQrDataUrl ? (
              <div className="mx-auto my-3 grid place-items-center rounded-xl bg-white p-3 shadow-inner border border-border w-fit">
                <img src={linkQrDataUrl} alt="Registration Link QR" className="h-48 w-48" />
              </div>
            ) : null}
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowQrModal(false)}>
                Close
              </Button>
              <Button size="sm" onClick={copyLink}>
                Copy Link
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
