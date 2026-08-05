# Remote access to the self-hosting PC

One-time setup so the PC can be driven from the Mac over SSH, which is what
`deploy/deploy-remote.sh` needs. Decision and rationale in `decisions.md`
ADR-012.

Two pieces: **Tailscale** provides the private network (the PC has no inbound
ports open to the internet and this does not change that), and **Windows
OpenSSH Server** provides the shell on top of it.

## 1. PC side (do this at the PC, once)

This is the bootstrap step that cannot be automated from the Mac - there is no
channel yet, which is the whole point.

### Install Tailscale

```powershell
winget install -e --id tailscale.tailscale
tailscale up
```

`tailscale up` opens a browser to authenticate. Use the same account you will
use on the Mac. Then note the machine name:

```powershell
tailscale status
```

**Done, 2026-08-05.** Both machines are on the tailnet:

```
100.71.206.105   macbook-pro       macOS
100.119.195.52   desktop-8n83f8s   windows
```

The PC's Tailscale name is `desktop-8n83f8s` (MagicDNS:
`desktop-8n83f8s.tail537ab3.ts.net`), which is just the Windows default
hostname. Rather than rename it, the Mac's `~/.ssh/config` maps the stable alias
`self-hosting-pc` onto it - so the scripts' `EO_PC_HOST` default keeps working
even if the machine is renamed later. See section 2.

### Enable OpenSSH Server

In an **Administrator** PowerShell:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
```

**Do not** set the OpenSSH `DefaultShell` registry value to PowerShell. It is a
commonly suggested tweak and it breaks `scp`/`sftp`, which `deploy-remote.sh`
relies on to push `.env.production`. Leave the default (`cmd.exe`);
`deploy-remote.sh` invokes `powershell -File ...` explicitly instead.

### Authorize the Mac's key

Get the public key from the Mac first (see section 2), then - and this is the
part that silently fails if you get it wrong - put it in the **right file**:

- If the Windows account is a **member of Administrators** (it is, on this box),
  `sshd` ignores `~/.ssh/authorized_keys` entirely and reads
  `C:\ProgramData\ssh\administrators_authorized_keys`, which must also have
  restrictive ACLs or it is ignored silently.

```powershell
$key = 'ssh-ed25519 AAAA...   # paste the Mac public key'
$path = 'C:\ProgramData\ssh\administrators_authorized_keys'
Add-Content -Path $path -Value $key

# Required, or sshd refuses the file without saying so in the default logs.
icacls $path /inheritance:r
icacls $path /grant 'Administrators:F' /grant 'SYSTEM:F'
```

If a key-based login still falls back to asking for a password, that ACL is
almost always the reason. `Get-Service sshd`, then check the sshd logs in Event
Viewer, or run `sshd -d` in the foreground to see the real reason.

### Firewall

Installing OpenSSH Server adds an inbound allow rule for port 22 on all
profiles. This box already restricts Steel's ports to localhost at the firewall
layer (see `status.md`); tighten SSH the same way so it is only reachable over
the Tailscale interface, not the LAN:

```powershell
Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -RemoteAddress 100.64.0.0/10
```

`100.64.0.0/10` is the CGNAT range Tailscale assigns from.

## 2. Mac side

**Done, 2026-08-05.** Tailscale installed via `brew install --cask tailscale-app`
and signed in. A dedicated key was generated for this - deliberately not the
existing GitHub key, so it can be revoked on the PC without affecting anything
else:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_selfhosting -C "mac -> self-hosting-pc"
```

No passphrase, because `deploy-remote.sh` has to run unattended. The key only
grants access to a machine already behind the tailnet, so it is not a
credential on its own.

The `~/.ssh/config` entry (added). `User` is the Windows account name -
Tailscale carries no identity into SSH, so this still matters:

```
Host self-hosting-pc
  HostName desktop-8n83f8s.tail537ab3.ts.net
  User tokki
  IdentityFile ~/.ssh/id_ed25519_selfhosting
  IdentitiesOnly yes
```

Verify:

```bash
tailscale status
ssh self-hosting-pc "powershell -NoProfile -Command 'docker ps --format \"{{.Names}}\"'"
```

That last command should list the running containers. If it does, deploys work.

## 3. Deploying

From the Mac, from the repo root:

```bash
./infra/self-hosting/deploy/deploy-remote.sh
```

By default it touches only code: it runs `deploy/deploy.ps1` on the PC (pull,
validate the env, rebuild, health-check, and dump `docker logs` automatically if
anything fails) and leaves `.env.production` alone.

**The PC's `.env.production` is the source of truth, not the Mac's
`.env.production.generated`.** The Mac copy is a stale subset - the box has keys
it has never had. Only pass `--push-env` if the local file is genuinely the
newer one; it will diff key names, refuse to drop keys the PC has (unless
`--force`), and back the remote file up first.

Flags: `--push-env`, `--force`, `--skip-pull` (build the PC's working tree
as-is). Environment overrides: `EO_PC_HOST`, `EO_PC_REPO`, `EO_ENV_FILE`.

## Notes

- **Power.** Tailscale adds a small always-on agent, which is a real (if minor)
  cost against this repo's primary 24/7-wattage constraint. Accepted
  deliberately - see ADR-012.
- **This does not replace the Cloudflare Tunnel.** That still serves
  `steel-api.paidinfunnel.com` and `app.paidinfunnel.com` to the public
  internet. Tailscale is administrative access only, for humans and deploys.
- **Docker Desktop still needs a logged-in desktop session.** SSH does not
  create one. The failure modes in `status.md` that needed the Docker Desktop
  GUI (the `AutoStart` setting, the cold-start API crash) are still not fixable
  over SSH alone - that would need RDP, which was considered and deferred.
