# SSH Proxy Router for Raycast

Route selected websites through an SSH SOCKS tunnel on macOS while every other website continues to use the normal network connection. The routed sites open under their ordinary HTTPS URLs in Safari—no browser extension or manual proxy switching is required.

The extension provides a Raycast command and menu-bar item for starting, stopping, testing, and inspecting the tunnel.

## Features

- Exact host rules such as `internal.example.com`
- Wildcard rules such as `*.corp.example.com`
- Normal website URLs in Safari and other macOS applications that honor system proxy settings
- Built-in macOS `/usr/bin/ssh`; no `autossh`, VPN client, or browser extension required
- `launchd` supervision for automatic tunnel recovery after network interruptions
- Automatic backup and restoration of existing macOS PAC settings
- All configuration stored in Raycast preferences
- Local listeners bind only to `127.0.0.1`

## Requirements

- macOS
- [Raycast](https://www.raycast.com/)
- Node.js 22 or newer and npm
- Working SSH key or SSH-agent access to a gateway that can reach the desired websites

Connect to the SSH gateway once in Terminal before using the extension. This lets SSH confirm the gateway's host key and verifies that authentication works:

```sh
ssh -p 22 username@gateway.example.com
```

## Installation

Clone the repository and install its dependencies:

```sh
git clone https://github.com/mariusrueve/raycast-ssh-proxy-router.git
cd raycast-ssh-proxy-router
npm install
npm run dev
```

Raycast opens the local extension. Run **SSH Proxy Router** once to activate its menu-bar item. You can then stop `npm run dev` with `Control-C`; the local extension remains installed in Raycast.

To update an existing installation:

```sh
git pull
npm install
npm run dev
```

## Configuration

Open **Raycast Settings → Extensions → SSH Proxy Router**.

| Setting | Description | Example |
| --- | --- | --- |
| SSH User | Account on the SSH gateway | `username` |
| SSH Gateway | Gateway that can reach the private websites | `gateway.example.com` |
| SSH Port | Gateway's SSH port | `22` |
| SSH Identity File | Optional private key; leave empty to use the SSH agent/config | `~/.ssh/id_ed25519` |
| Routed Websites | Comma-separated exact hosts, URLs, or wildcard hosts | `wiki.example.com, *.corp.example.com` |
| Primary Website URL | Optional URL used by **Open Primary Website** | `https://wiki.example.com` |
| Local SOCKS Port | Local dynamic-forward port | `1080` |
| Local PAC Port | Local PAC-file server port | `18080` |
| Start Timeout | Seconds allowed for SSH startup | `15` |
| Network Services | Optional comma-separated macOS services; empty applies to every enabled service | `Wi-Fi` |
| Open in Safari | Open menu-bar website actions specifically in Safari | Enabled |

### Routing rules

Rules are separated with commas or semicolons.

- `internal.example.com` routes only that exact hostname.
- `*.corp.example.com` routes both `corp.example.com` and all its subdomains.
- `https://review.example.com/path` is accepted and normalized to `review.example.com`.

Only matching hosts use the SSH tunnel. The PAC file returns `DIRECT` for all other traffic.

After editing routing or connection settings, choose **Repair SSH Proxy Router** from the menu-bar item (or stop and start it) to regenerate the tunnel and PAC configuration.

## How it works

When started, the extension:

1. Creates a user LaunchAgent for an SSH dynamic forward bound to `127.0.0.1`.
2. Generates a PAC file containing the selected exact and wildcard host rules.
3. Creates a second user LaunchAgent that serves the PAC file on localhost.
4. Saves the current automatic-proxy settings for each selected macOS network service.
5. Enables the localhost PAC URL.

Stopping the extension restores the saved proxy settings and removes both LaunchAgents. Raycast itself does not need to stay open for the tunnel to remain active.

## Troubleshooting

- Confirm direct SSH access works using the same user, gateway, and port.
- Ensure the SOCKS and PAC ports are not already occupied.
- If a host is not routed, enter only its hostname or a supported `*.` wildcard—not a general glob or regular expression.
- Use **Test Routed Websites** from the menu bar to check the configured exact hosts through the tunnel.
- Runtime logs are stored in `~/.local/state/raycast-ssh-proxy-router/`.
- If settings were changed while active, use **Repair SSH Proxy Router**.

## Development

```sh
npm install
npm run build
npm run lint
npm run dev
```

## License

MIT
