# Sidebar Logo Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's generated brand treatment with the supplied Outbound System PNG lockup.

**Architecture:** Store the provided asset in `public` and render it with Next.js `Image` inside the existing home link. Preserve the sidebar header dimensions and navigation behavior.

**Tech Stack:** Next.js 15, React, TypeScript, Next.js Image.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-31-sidebar-logo-design.md`.
- Preserve the complete logo aspect ratio and transparency.
- Preserve the existing `/` link and sidebar navigation layout.
- Remove the old icon and duplicate text.

---

### Task 1: Install and render the logo

**Files:**
- Create: `public/outbound-system-logo.png`
- Modify: `app/(dashboard)/layout.tsx`

**Interfaces:**
- The sidebar home link renders `Image` with source `/outbound-system-logo.png`, intrinsic dimensions 2652 by 508, and alternative text `Outbound System`.

- [ ] Copy `/Users/julian/Downloads/outboundsystemlogo.png` to `public/outbound-system-logo.png` and verify its checksum matches.
- [ ] Import `Image` from `next/image` and replace the old favicon plus text with the full lockup at approximately 165 pixels wide.
- [ ] Run type checking, lint, and the UI detector.
- [ ] Inspect the logo in the running dashboard and confirm the `/` link remains intact.
