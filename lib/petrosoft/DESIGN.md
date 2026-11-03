---
name: Petrosoft replica
description: Source-faithful petrol pump administration interface.
colors:
  source-navy: "#263172"
  source-indigo: "#3f51b5"
  action-dark: "#222e6c"
  action-light: "#5870ff"
  entry-blue: "#2d52b3"
  entry-light: "#4a76e0"
  entry-hover-blue: "#3b66d1"
  entry-hover-light: "#6a92ec"
  submit-green: "#61ab61"
  submit-hover-green: "#3b8b3be3"
  paper: "#ffffff"
  field-ink: "#333"
  field-line: "#ddd"
  primary: "#292f8d"
  background: "#e5eafa"
  ink: "#212a39"
  muted: "#657095"
  line: "#ccd5f0"
  success: "#379553"
  status-green: "#10b981"
  danger: "#b3261e"
  focus: "#5273ed"
  overlay: "rgb(21 30 64 / 48%)"
typography:
  body:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5384616
  title:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "19px"
    letterSpacing: "0.5px"
  label:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  small-field:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "12px"
    lineHeight: 1.6666667
  dialog-title:
    fontFamily: "Roboto, Arial, sans-serif"
    fontSize: "18px"
rounded:
  small-field: "2px"
  control: "3px"
  container: "5px"
  entry: "8px"
  dashboard-card: "14px"
spacing:
  row-gap: "8px"
  field-gap: "16px"
  mobile-dialog: "12px"
  dialog: "20px"
components:
  button-gradient:
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-submit:
    backgroundColor: "{colors.submit-green}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-submit-hover:
    backgroundColor: "{colors.submit-hover-green}"
    textColor: "{colors.paper}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.field-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
    height: "36px"
  input-small:
    typography: "{typography.small-field}"
    rounded: "{rounded.small-field}"
    padding: "6px 11px"
    height: "34px"
  day-entry:
    textColor: "{colors.paper}"
    rounded: "{rounded.entry}"
  status:
    backgroundColor: "{colors.status-green}"
    textColor: "{colors.paper}"
    padding: ".2em .6em .3em"
  form-panel:
    rounded: "{rounded.container}"
    padding: "2em 1em"
  report-table:
    textColor: "{colors.ink}"
    padding: "8px"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.container}"
---

# Design System: Petrosoft replica

## Overview

**Creative North Star: "The original Petrosoft interface"**

This is a scan of the shipped source reproduction. The user's one-to-one brief establishes the visual authority: the accessible Petrosoft application, its captured templates, and its original assets. The dense forms, bordered tables, blue gradients, cards, labels, and icon vocabulary are inherited choices.

This document applies to `/petrosoft`, its local API views, and their assets. The older `/dashboard` application keeps its own design. Interface fidelity does not establish complete financial or provider parity; those limits remain in [PETROSOFT.md](../../docs/PETROSOFT.md).

**Key Characteristics:**

- Compact operational forms and tables.
- Dark blue framing, brighter blue gradients, and white fields.
- Original labels, fonts, navigation, and assets.
- Local feedback and usable mobile forms without changing the source identity.

## Colors

The palette combines the source's blue framing and gradients with green submission and status treatments. Frontmatter contains observed values, not a newly normalized palette.

### Primary

- **Source navy / source indigo:** header and recurring diagonal form-panel gradient.
- **Action dark / action light:** uppercase action-button gradient; the direction reverses on hover.
- **Entry blue / entry light:** the prominent Day Entry navigation item. Its hover and active treatment uses the brighter entry pair.
- **Local primary / focus:** controller links and caret color, with the runtime keyboard-focus cue.

### Secondary

- **Submit green:** the source's ordinary primary submission buttons; preserve the separate green hover treatment.
- **Status green / success:** source table badges and local success feedback respectively.
- **Danger:** local error text and borders.

### Neutral

- **Paper / field ink / field line:** white fields with the source's dark text and thin gray borders.
- **Background / ink / muted / line:** local results, record details, report borders, and dialog framing.
- **Overlay:** local modal backdrop and overlay shadows.

**The Source Authority Rule.** Preserve the source's contextual colors and gradients. Their provenance justifies exceptions to generic advice about reducing gradients, cards, or legacy icon styles.

## Typography

**Body Font:** Roboto, with Arial and sans-serif fallbacks.

The shared interface favors compact, practical text. Original font files remain under the local asset tree. The source contains page-specific type treatments; this document does not promote every local override into a universal role.

### Hierarchy

- **Title:** recurring form-section headings with slightly spaced lettering; heading weight stays with the source template.
- **Body:** compact forms, navigation, table controls, and buttons.
- **Label:** ordinary field labels; retain template-specific emphasis and wording.
- **Small field:** the source's compact input variant.
- **Dialog title:** local modal heading, visually separated from its content.

Tables use tabular numerals. Keep numeric formatting and terminology in the existing controllers.

## Layout

Retain the source header, sidebar, breadcrumbs, form groups, and table order. Desktop forms use the inherited column grid; the runtime mobile sidebar opens as a fixed, scrollable panel (230px wide). Shared gaps use the observed row and field steps in frontmatter.

At the runtime phone breakpoint (maximum 768px), dialogs use the smaller inset, record details become one column, and narrow dialog columns expand to full width. Tables keep horizontal scrolling inside their wrappers. Avoid document overflow; keep table filtering, export buttons, page-length selection, and pagination accessible.

MS, HSD, and OIL meter summaries become a two-column label/value grid on phones. Each product heading spans the row; summary inputs retain a readable minimum width (80px) and height (32px). Tank summaries wrap with labels above their readonly inputs. Vehicle forms place the add/remove controls in their own flowing row instead of overlapping the fields.

## Elevation & Depth

The source mixes gradient panels, white cards, borders, and contextual shadows. Preserve those distinctions. Local dialogs and notices use overlay-based shadows; the source Day Entry item has a white edge and dark lift. These are extracted treatments, not a new elevation scale.

### Shadow Vocabulary

- **Dialog:** `0 12px 40px var(--ps-overlay)`.
- **Notice:** `0 6px 22px var(--ps-overlay)`.
- **Day Entry:** `0 0 0 1px rgba(255, 255, 255, 0.35), 0 4px 14px rgba(0, 0, 0, 0.25)`.
- **Source dashboard card:** `0 4px 14px rgba(26, 35, 126, 0.06)`.

## Shapes

Fields and ordinary buttons have small corners. Form panels and local overlays share the modest container radius; Day Entry has larger clipped corners, and the source dashboard uses softer cards. Preserve each component's shape instead of applying one radius everywhere.

Original table action images remain square (32px); status-switch images retain their width (35px) and natural aspect ratio. These dimensions describe the images, not a universal button target.

## Components

### Buttons

Source action buttons use the diagonal blue gradient and uppercase text; hover reverses the gradient and adds the original drop shadow. Ordinary source submission buttons remain green. Keep contextual variants and labels from the templates.

The runtime focus cue uses the focus token with an outline (2px) and offset (2px). Submission busy state lowers opacity and prevents repeat interaction. Reduced-motion preferences shorten transitions and animations.

### Cards / Containers

Operational forms retain the source navy-to-indigo gradient, white controls, container corners, and compact spacing. White dashboard cards retain their original grouping and softer corners. Do not turn the entire application into one generic card treatment.

### Inputs / Fields

Preserve ordinary and small input sizes from frontmatter, thin borders, native date controls, and the existing local relation selectors. Required, readonly, and computed fields keep their distinct semantics.

Tank readonly labels stay above their values and remain associated with their inputs. Vehicle add/remove controls flow after the field row on phones. Source legacy focus suppression is not reusable guidance for new controls.

### Navigation

Keep original menu order, labels, local assets, and contextual active states. Day Entry remains the blue-gradient emphasis item. The mobile toggle controls the scrollable sidebar; keyboard access and visible button focus remain part of the local behavior.

### Tables / Status

Preserve source headers, column order, density, and the DataTables control arrangement: filter and available exports, page-length selection, table, then information and pagination. Local controllers supply rows and actions. Empty tables use the existing empty message.

Keep the original action images and status switches at their observed dimensions. Local buttons retain accessible action names. Green status badges are a separate treatment from switch images.

### Dialogs

Local dialogs have a labeled heading, white body, close control, and optional footer. They cap their desktop width rather than forcing it. On opening, focus moves to the first visible body control, or the available fallback. Tab wraps through visible enabled controls; Escape and backdrop dismissal close the dialog, and closing restores the invoking focus. The backdrop scrolls when content exceeds the viewport.

The [design sidecar](.impeccable/design.json) contains small standalone styling specimens. Its table and dialog examples show appearance; the shipped controllers provide their interactive behavior. Examples contain no station records or financial values.

## Do's and Don'ts

### Do:

- **Do** follow the source templates, asset vocabulary, labels, and contextual gradients.
- **Do** keep table controls usable within local scrolling wrappers.
- **Do** preserve readable mobile product summaries, readonly labels, and separate vehicle action rows.
- **Do** retain dialog focus entry, keyboard containment, dismissal, and focus restoration.
- **Do** keep this design scoped to Petrosoft and consult PETROSOFT.md for delivery limits.

### Don't:

- **Don't** replace the source identity with a new palette, typography pairing, or layout concept.
- **Don't** canonize overlapping fields, hidden overflow, legacy focus suppression, or broken images.
- **Don't** introduce private records, credentials, screenshots, or invented financial examples into design artifacts.
- **Don't** treat styling specimens as evidence of complete software or financial parity.
