import { getSettings } from "@/lib/config/settings";
import { SettingsForm } from "@/components/settings/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettings(true);
  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">API keys, search settings, and keyword filters.</p>
      </div>
      <SettingsForm initial={settings} />
    </div>
  );
}
