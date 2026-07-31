"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Mic, X } from "lucide-react";
import { VoiceComposer } from "@/components/voice-message/voice-composer";

export function VoiceDmButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground"
        title="Generate a voice DM for this lead"
        aria-label={`Generate a voice DM for @${username}`}
      >
        <Mic className="h-3.5 w-3.5" />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          >
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-10 bg-background border rounded-lg shadow-xl w-full max-w-xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Voice DM for @{username}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <VoiceComposer initialUsername={username} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
