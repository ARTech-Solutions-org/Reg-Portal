# Design direction — Event Management & QR Check-in System

## Candidate directions

- **Atlas Operations — 0.07.** A calm, precise event-operations control plane with crisp data hierarchy and an understated signature color.
- **Aurea Guesthouse — 0.04.** A warm, editorial hospitality ledger with expressive typography and human, guest-first moments.
- **Signal After Dark — 0.02.** A high-contrast nocturnal scanner console with bold signal accents and stage-light energy.

**Selected: Atlas Operations.** The archive already supplies the ALMIRA AUREA / event ops identity and Gatepass naming; retain that identity while applying an operations-first interface suited to large attendee lists and event-day scanning. Do not add generic stock imagery; this is an internal dashboard/scanner product and custom imagery is not materially part of its workflows.

## Expanded design system

- **Design movement:** Contemporary editorial software with a practical control-room sensibility: measured rather than sterile, precise rather than industrial.
- **Core principles:** Put the next operational decision first; make event context unmistakable; use numbers and status labels that are easy to scan at a distance; reserve high-salience color for actions, warnings, and scan outcomes; preserve generous whitespace around dense data.
- **Color philosophy:** Warm mineral-white page surfaces and paper-like cards against deep ink/navy text. Use a clear saturated cobalt as the action/selection accent, a restrained evergreen for valid check-ins, and muted amber for pending/attention. Keep destructive states distinctly red. Avoid gradients and neon.
- **Layout paradigm:** Persistent compact navigation rail for admin, a clear top event/project context switcher, broad content canvas with one strong page title, a compact row of key metrics, and readable tables. The scanner is a separate mobile-first full-height surface with one dominant camera frame and an unmistakable result state.
- **Signature elements:** Thin registration-line motifs, small mono-spaced event IDs, QR corner marks used sparingly, restrained dividers, and compact status pills. The ALMIRA AUREA wordmark remains text-led with “event ops” as the descriptor.
- **Interaction philosophy:** Direct manipulation for the badge designer; optimistic updates for ordinary admin edits; explicit server confirmation for attendee creation and check-in results; keyboard-accessible controls, clear focus rings, and a manual scanner fallback.
- **Animation:** Quiet 120–180ms transitions for navigation, selection and result states; no looping decorative animation. Respect reduced-motion preferences. The camera target can have a static scan frame with a brief confirmation pulse only.
- **Typography system:** A legible modern sans for UI/body, a modest editorial display face for page titles, and a tabular/monospaced face for QR IDs, timestamps and numeric metrics. Use a system-friendly fallback stack and avoid loading unnecessary fonts on the scanner.
- **Brand essence:** ALMIRA AUREA / Gatepass is the composed operations partner behind an event entrance: exact, calm, dependable.
- **Brand voice:** Short, plain, reassuring and specific. A scan returns an actionable verdict and the attendee identity; errors explain the next step without blaming the operator.
- **Wordmark/logo:** Preserve the supplied “ALMIRA” wordmark and “AUREA / event ops” descriptor in the interface. Create a separate, clean full-bleed square project mark for the project favicon and platform card, using a gate/scan registration metaphor without embedded words.
- **Signature brand color:** Cobalt, used selectively for primary actions and active navigation rather than as a large decorative field.

## Event-level scanner rebranding

Organizers can replace the scanner's event-facing brand name, descriptor, and logo, then tune its accent, page, panel, text, and muted-text colors in a live mobile preview. Keep the scanner's mobile-first control-room hierarchy and quiet camera frame; treat the organizer's palette as surface/identity customization, not a replacement for status meaning. Valid check-ins stay clearly green, duplicates amber, and invalid scans red so the gate team can read results at a glance. Contain uploaded logos without cropping and preserve readable text contrast. The ALMIRA AUREA / Gatepass identity remains the unsaved default.
