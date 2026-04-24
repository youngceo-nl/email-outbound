"use client";
import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { addNote } from "@/app/actions/notes";
import { formatDistanceToNow } from "date-fns";

type Note = { id: string; body: string; created_at: string };

export function NotesSection({ leadId, notes }: { leadId: string; notes: Note[] }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = body.trim();
            if (!text) return;
            start(async () => {
              await addNote(leadId, text);
              setBody("");
            });
          }}
          className="space-y-2"
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note (outreach status, custom angle, etc.)" />
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>{pending ? "Saving…" : "Add note"}</Button>
        </form>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="text-sm border rounded-md p-3">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
            </li>
          ))}
          {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
        </ul>
      </CardContent>
    </Card>
  );
}
