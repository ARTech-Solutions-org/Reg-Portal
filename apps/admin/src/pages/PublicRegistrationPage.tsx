import { useState, useEffect, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Calendar,
  MapPin,
  CheckCircle2,
  AlertCircle,
  QrCode,
  Download,
  Printer,
  RotateCcw,
  UserCheck,
} from "lucide-react";
import {
  publicEventRegistrationInfoSchema,
  publicRegistrationInputSchema,
  publicRegistrationResultSchema,
  type PublicEventRegistrationInfo,
  type PublicRegistrationResult,
} from "@eventdesk/contracts";
import { apiContract, ApiError } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const getDeviceId = (eventId: string): string => {
  const storageKey = `eventdesk:devid:${eventId}`;
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = "dev_" + Math.random().toString(36).substring(2, 12) + "_" + Date.now().toString(36);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* Ignore storage errors */
    }
  }
  return id;
};

export default function PublicRegistrationPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [registrationResult, setRegistrationResult] = useState<PublicRegistrationResult | null>(null);

  // Local device registration counter
  const localKey = `eventdesk:reg_count:${eventId}`;
  const [localRegCount, setLocalRegCount] = useState<number>(() => {
    try {
      return parseInt(localStorage.getItem(localKey) || "0", 10) || 0;
    } catch {
      return 0;
    }
  });

  const deviceId = getDeviceId(eventId);

  const {
    data: info,
    isLoading,
    error,
  } = useQuery<PublicEventRegistrationInfo>({
    queryKey: ["public-registration-info", eventId],
    queryFn: () =>
      apiContract(
        `/events/${eventId}/public-registration`,
        publicEventRegistrationInfoSchema,
      ),
    enabled: Boolean(eventId),
    retry: 1,
  });

  const isDeviceLimitReached = Boolean(
    info &&
      info.maxRegistrationsPerDevice > 0 &&
      localRegCount >= info.maxRegistrationsPerDevice,
  );

  const registerMutation = useMutation({
    mutationFn: (data: { name: string; email: string; customFields: Record<string, string> }) =>
      apiContract(`/events/${eventId}/public-registration`, publicRegistrationResultSchema, {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          email: data.email || undefined,
          customFields: data.customFields,
          deviceId,
        }),
      }),
    onSuccess: (result) => {
      try {
        const nextCount = localRegCount + 1;
        localStorage.setItem(localKey, String(nextCount));
        setLocalRegCount(nextCount);
      } catch { /* Ignore storage errors */ }
      setRegistrationResult(result);
    },
    onError: (err) => {
      alert(err instanceof ApiError ? err.message : "Unable to complete registration. Please try again.");
    },
  });

  const handleCustomFieldChange = (key: string, value: string) => {
    setCustomFields((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!name.trim()) {
      errors.name = "Please enter your full name.";
    }

    if (info?.fields) {
      for (const field of info.fields) {
        if (field.required) {
          const val = customFields[field.key]?.trim();
          if (!val) {
            errors[field.key] = `Field "${field.label}" is required.`;
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    registerMutation.mutate({ name, email, customFields });
  };

  const handleReset = () => {
    setName("");
    setEmail("");
    setCustomFields({});
    setFieldErrors({});
    setRegistrationResult(null);
  };

  const downloadQr = () => {
    if (!registrationResult?.qrDataUrl) return;
    const a = document.createElement("a");
    a.href = registrationResult.qrDataUrl;
    a.download = `event-qr-${registrationResult.attendee.name.replace(/\s+/g, "_")}.png`;
    a.click();
  };

  const handlePrint = () => {
    window.print();
  };

  const formattedDate = info?.startsAt
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      }).format(new Date(info.startsAt))
    : null;

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="text-center space-y-3">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading registration page…</p>
        </div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div className="max-w-md space-y-4">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-bold">Event Not Found</h1>
          <p className="text-sm text-muted-foreground">
            Please verify the link address or contact the event organizer.
          </p>
        </div>
      </div>
    );
  }

  if (!info.isOpen) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-bold">Registration is Closed</h1>
          <p className="text-sm text-muted-foreground">
            Registration for {info.eventName} has ended. Please contact the organizers for more information.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70 dark:bg-slate-950 py-10 px-4 sm:px-6">
      <div className="mx-auto max-w-xl">
        {/* Event Header Branding Card */}
        <div className="mb-6 rounded-2xl border border-border/80 bg-white dark:bg-card p-6 shadow-sm">
          <div className="flex flex-col items-center text-center space-y-3">
            {info.branding?.logoDataUrl && (
              <img
                src={info.branding.logoDataUrl}
                alt="Logo"
                className="h-16 w-auto max-w-[200px] object-contain mb-1"
              />
            )}
            <Badge tone="default" className="text-xs uppercase tracking-wider text-primary border border-primary/20 bg-primary/[0.04]">
              Event Registration
            </Badge>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {info.title.trim() || info.eventName}
            </h1>
            {info.description && (
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed whitespace-pre-line">
                {info.description}
              </p>
            )}

            {(formattedDate || info.venue) && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-xs text-muted-foreground">
                {formattedDate && (
                  <div className="flex items-center gap-1.5 bg-muted/60 px-3 py-1.5 rounded-full">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    <span>{formattedDate}</span>
                  </div>
                )}
                {info.venue && (
                  <div className="flex items-center gap-1.5 bg-muted/60 px-3 py-1.5 rounded-full">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    <span>{info.venue}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Main Content: Either Confirmation Screen or Form */}
        {registrationResult ? (
          /* Success Screen */
          <div className="rounded-2xl border border-border bg-white dark:bg-card p-6 sm:p-8 shadow-sm space-y-6 text-center animate-enter">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Registration Successful!
              </h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                {registrationResult.message}
              </p>
            </div>

            {/* Attendee Details Card */}
            <div className="mx-auto max-w-sm rounded-xl border border-border bg-muted/30 p-4 text-sm text-start space-y-2">
              <div className="flex justify-between items-center border-b border-border/60 pb-2">
                <span className="text-xs text-muted-foreground">Full Name:</span>
                <span className="font-semibold text-foreground">{registrationResult.attendee.name}</span>
              </div>
              {registrationResult.attendee.email && (
                <div className="flex justify-between items-center border-b border-border/60 pb-2">
                  <span className="text-xs text-muted-foreground">Email:</span>
                  <span className="font-mono text-xs text-foreground">{registrationResult.attendee.email}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Ticket:</span>
                <Badge tone="neutral" className="text-xs font-semibold">{registrationResult.attendee.ticketType}</Badge>
              </div>
            </div>

            {/* QR Code Presentation (ONLY if showQrCode is true) */}
            {registrationResult.showQrCode && registrationResult.qrDataUrl ? (
              <div className="mx-auto max-w-sm rounded-2xl border-2 border-primary/20 bg-primary/[0.02] p-6 space-y-4 shadow-sm">
                <div className="flex items-center justify-center gap-2 text-xs font-semibold text-primary">
                  <QrCode className="h-4 w-4" />
                  <span>Entrance Pass (QR Code)</span>
                </div>
                <div className="mx-auto grid place-items-center rounded-xl bg-white p-3 shadow-sm border border-border w-fit">
                  <img
                    src={registrationResult.qrDataUrl}
                    alt="Attendee QR Code"
                    className="h-52 w-52 object-contain"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Please save or screenshot this QR code to present at the event entrance for fast check-in.
                </p>
                <div className="flex items-center justify-center gap-2 pt-1">
                  <Button onClick={downloadQr} size="sm" className="gap-2">
                    <Download className="h-4 w-4" />
                    Download QR
                  </Button>
                  <Button onClick={handlePrint} variant="outline" size="sm" className="gap-2">
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                </div>
              </div>
            ) : (
              /* If showQrCode is FALSE */
              <div className="rounded-xl bg-muted/40 p-4 border border-border text-center text-xs text-muted-foreground max-w-md mx-auto">
                <p>Your details have been registered on the guest list. Our team will guide you upon arrival.</p>
              </div>
            )}

            <div className="pt-4 border-t border-border">
              {isDeviceLimitReached ? (
                <p className="text-xs text-muted-foreground text-center">
                  Maximum registration limit reached for this device ({info?.maxRegistrationsPerDevice}).
                </p>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleReset} className="gap-2 text-muted-foreground hover:text-foreground">
                  <RotateCcw className="h-4 w-4" />
                  Register Another Person
                </Button>
              )}
            </div>
          </div>
        ) : isDeviceLimitReached ? (
          <Card className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] shadow-sm">
            <CardContent className="p-6 sm:p-8 space-y-4 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-500/10 text-amber-600">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h2 className="font-display text-xl font-bold text-foreground">
                Registration Limit Reached
              </h2>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                The event organizer has set a maximum limit of {info.maxRegistrationsPerDevice} {info.maxRegistrationsPerDevice === 1 ? "submission" : "submissions"} from the same device. You have already registered from this browser.
              </p>
            </CardContent>
          </Card>
        ) : (
          /* Registration Form */
          <Card className="rounded-2xl border border-border bg-white dark:bg-card shadow-sm">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="border-b border-border pb-4">
                <h2 className="font-display text-lg font-semibold text-foreground">Registration Details</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Please fill in your details accurately</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Full Name (Primary Required Field) */}
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Full Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: "" }));
                    }}
                    placeholder="e.g. John Doe"
                    className={`input-control ${fieldErrors.name ? "border-destructive ring-destructive/10" : ""}`}
                  />
                  {fieldErrors.name && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors.name}</p>
                  )}
                </div>

                {/* Optional Email */}
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="input-control"
                  />
                </div>

                {/* Dynamic Admin-Configured Custom Fields */}
                {info.fields.map((field) => {
                  const errorMsg = fieldErrors[field.key];
                  const value = customFields[field.key] ?? "";

                  return (
                    <div key={field.id} className="space-y-1.5">
                      <label className="block text-xs font-semibold text-foreground">
                        {field.label} {field.required && <span className="text-destructive">*</span>}
                      </label>

                      {field.type === "select" ? (
                        <select
                          value={value}
                          onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                          className={`input-control ${errorMsg ? "border-destructive ring-destructive/10" : ""}`}
                          required={field.required}
                        >
                          <option value="">-- Select an option --</option>
                          {field.options?.map((opt, i) => (
                            <option key={i} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea
                          rows={3}
                          value={value}
                          onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                          placeholder={field.placeholder || `Enter ${field.label}...`}
                          required={field.required}
                          className={`w-full rounded-xl border bg-white p-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/10 ${
                            errorMsg ? "border-destructive ring-destructive/10" : "border-input"
                          }`}
                        />
                      ) : (
                        <input
                          type={
                            field.type === "number"
                              ? "number"
                              : field.type === "phone"
                              ? "tel"
                              : field.type === "email"
                              ? "email"
                              : "text"
                          }
                          value={value}
                          onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                          placeholder={field.placeholder || `Enter ${field.label}...`}
                          required={field.required}
                          className={`input-control ${errorMsg ? "border-destructive ring-destructive/10" : ""}`}
                        />
                      )}

                      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
                    </div>
                  );
                })}

                <div className="pt-3">
                  <Button
                    type="submit"
                    className="w-full h-11 text-sm font-semibold gap-2 shadow-md"
                    disabled={registerMutation.isPending}
                  >
                    {registerMutation.isPending ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>Submitting registration…</span>
                      </>
                    ) : (
                      <>
                        <UserCheck className="h-4 w-4" />
                        <span>Confirm Registration</span>
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="mt-8 text-center text-xs text-muted-foreground">
          <span>Powered by </span>
          <span className="font-semibold text-foreground">Gatepass</span>
        </div>
      </div>
    </div>
  );
}
