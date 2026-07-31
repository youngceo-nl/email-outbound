# Sidebar logo replacement

_2026-07-31_

## Goal

Replace the dashboard sidebar's generated icon and two-line "Email Outbound
System" text with the supplied full logo lockup from
`/Users/julian/Downloads/outboundsystemlogo.png`.

## Design

Copy the source PNG into the application's `public` directory under a stable,
descriptive filename. Render it through Next.js `Image` inside the existing
home link in `app/(dashboard)/layout.tsx`.

The source is 2652 by 508 pixels with transparency. Display it at approximately
165 pixels wide with its intrinsic aspect ratio preserved. Keep the current
sidebar header height, horizontal padding, navigation position, and home-link
behavior. Remove the old generated icon and duplicate text. Use "Outbound
System" as the image alternative text.

## Verification

Type checking and lint must introduce no errors. Browser verification confirms
that the complete mark and wordmark are visible without clipping, distortion,
or navigation movement at the normal dashboard viewport. The logo link must
still navigate to `/`.
