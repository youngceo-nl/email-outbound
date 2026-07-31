import { HowToUseClient } from "@/components/how-to-use/how-to-use-client";

export default function HowToUsePage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How to use</h1>
        <p className="text-sm text-muted-foreground">
          The daily workflow, step by step, with the SOP for each step attached.
        </p>
      </div>
      <HowToUseClient />
    </div>
  );
}
