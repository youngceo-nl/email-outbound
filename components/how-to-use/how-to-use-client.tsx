"use client";

import { useState } from "react";
import { FileText, ExternalLink, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CURRICULUM } from "@/components/how-to-use/curriculum";

export function HowToUseClient() {
  const chapter = CURRICULUM[0];
  const [activeStep, setActiveStep] = useState(chapter.lessons[0].step);
  const lesson = chapter.lessons.find((l) => l.step === activeStep) ?? chapter.lessons[0];
  const docUrl = lesson.docId ? `https://docs.google.com/document/d/${lesson.docId}` : undefined;

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6 h-[calc(100vh-9rem)]">
      <aside className="border rounded-xl bg-muted/20 overflow-y-auto">
        <div className="px-4 py-3 border-b">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Chapter 1
          </p>
          <p className="text-sm font-semibold">{chapter.title}</p>
        </div>
        <nav className="p-2 space-y-1">
          {chapter.lessons.map((l) => (
            <button
              key={l.step}
              onClick={() => setActiveStep(l.step)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                l.step === activeStep
                  ? "bg-primary/10 text-foreground ring-1 ring-primary/30"
                  : "hover:bg-accent text-foreground/90"
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums">
                {l.step}
              </span>
              <span className="flex-1 truncate">{l.title}</span>
              {l.hasSop && <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </nav>
      </aside>

      <section className="border rounded-xl overflow-y-auto">
        <div className="p-6 border-b space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {lesson.step}
          </p>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">{lesson.title}</h2>
            {lesson.hasSop ? (
              <Badge variant="secondary">SOP</Badge>
            ) : (
              <Badge variant="outline">Report</Badge>
            )}
          </div>
        </div>

        <div className="p-6 space-y-4">
          {lesson.body.map((paragraph, i) => (
            <p key={i} className="text-sm leading-relaxed text-foreground/90">
              {paragraph}
            </p>
          ))}
        </div>

        {docUrl && (
          <div className="px-6 pb-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Attached SOP
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href={docUrl} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                  <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                </a>
              </Button>
            </div>
            <div className="rounded-lg border overflow-hidden bg-muted/10">
              <iframe
                src={`${docUrl}/preview`}
                title={`SOP: ${lesson.title}`}
                className="w-full h-[500px]"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              If the preview above shows an access error, use "Open in new tab" instead - the doc
              may not be shared as "Anyone with the link can view".
            </p>
          </div>
        )}

        {lesson.step === chapter.lessons.length && (
          <div className="mx-6 mb-6 flex items-start gap-2 rounded-lg border bg-muted/20 p-4 text-sm">
            <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-muted-foreground">
              That's the full daily workflow. Once step 9 is done for the day, you're finished.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
