import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export function createClaude(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
