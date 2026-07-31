"use client";
import { useState, useTransition } from "react";
import { generateVoiceClip } from "@/app/actions/voice-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Download } from "lucide-react";

export function VoiceComposer({ initialUsername = "" }: { initialUsername?: string }) {
  const [username, setUsername] = useState(initialUsername);
  const [text, setText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateVoiceClip(text);
      if (!result.ok) {
        setError(result.error);
        setAudioUrl(null);
        return;
      }
      setAudioUrl(`data:audio/wav;base64,${result.audioBase64}`);
    });
  }

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ig-username">Instagram username (for your reference)</Label>
            <Input
              id="ig-username"
              placeholder="@lead_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message-text">Message</Label>
            <Textarea
              id="message-text"
              placeholder="Hey, saw your page and..."
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <Button onClick={onGenerate} disabled={isPending || !text.trim()}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Generate voice message
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {audioUrl && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <audio controls src={audioUrl} className="w-full" />
            <a href={audioUrl} download={`voice-message-${username || "clip"}.wav`}>
              <Button variant="outline">
                <Download className="h-4 w-4" />
                Download to send in Instagram
              </Button>
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
