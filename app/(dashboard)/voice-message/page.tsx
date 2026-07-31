import { VoiceComposer } from "@/components/voice-message/voice-composer";

export default function VoiceMessagePage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Voice DM</h1>
        <p className="text-sm text-muted-foreground">
          Type a message, generate it in your cloned voice, then download the clip and attach it
          to the DM yourself in Instagram.
        </p>
      </div>
      <VoiceComposer />
    </div>
  );
}
