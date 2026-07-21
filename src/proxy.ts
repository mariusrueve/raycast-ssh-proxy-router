import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import net from "node:net";
import { promisify } from "node:util";
import { getPreferenceValues } from "@raycast/api";

const execFileAsync = promisify(execFile);

const NETWORKSETUP = "/usr/sbin/networksetup";
const LAUNCHCTL = "/bin/launchctl";
const PYTHON = "/usr/bin/python3";
const SSH = "/usr/bin/ssh";
const CURL = "/usr/bin/curl";

const PAC_LAUNCHD_LABEL = "com.raycast.ssh-proxy-router.pac";
const SSH_LAUNCHD_LABEL = "com.raycast.ssh-proxy-router.ssh";
const STATE_DIR = path.join(homedir(), ".local", "state", "raycast-ssh-proxy-router");
const PAC_FILE = path.join(STATE_DIR, "proxy.pac");
const PAC_LOG_FILE = path.join(STATE_DIR, "pac-server.log");
const SSH_LOG_FILE = path.join(STATE_DIR, "ssh-tunnel.log");
const PROXY_BACKUP_FILE = path.join(STATE_DIR, "automatic-proxy-backup.json");
const PAC_LAUNCH_AGENT_FILE = path.join(homedir(), "Library", "LaunchAgents", `${PAC_LAUNCHD_LABEL}.plist`);
const SSH_LAUNCH_AGENT_FILE = path.join(homedir(), "Library", "LaunchAgents", `${SSH_LAUNCHD_LABEL}.plist`);

export type Preferences = {
  sshUser: string;
  sshHost: string;
  sshPort: string;
  identityFile?: string;
  routedHosts: string;
  primaryURL?: string;
  socksPort: string;
  pacPort: string;
  startTimeout: string;
  networkServices?: string;
  openInSafari: boolean;
};

type Config = {
  sshUser: string;
  sshHost: string;
  sshPort: number;
  identityFile?: string;
  routedHosts: RouteRule[];
  primaryURL: string;
  socksPort: number;
  pacPort: number;
  startTimeoutMs: number;
  networkServices?: string[];
  openInSafari: boolean;
};

type SavedProxySetting = {
  service: string;
  url: string | null;
  enabled: boolean;
};

type RouteRule = {
  host: string;
  wildcard: boolean;
};

export type RoutedWebsite = {
  title: string;
  url: string;
};

export type ProxyStatus = {
  running: boolean;
  degraded: boolean;
  detail: string;
  tunnel: boolean;
  pacServer: boolean;
  routing: boolean;
};

function parseInteger(name: string, value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

function normalizeHost(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error("Routed Websites cannot contain an empty entry.");
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host.includes("*")) throw new Error();
    return host;
  } catch {
    throw new Error(`Invalid routed website: ${value}`);
  }
}

function parseRouteRules(value: string): RouteRule[] {
  const entries = value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error("Add at least one host under Routed Websites.");

  const rules = entries.map((entry) => {
    const wildcard = entry.startsWith("*.");
    const host = normalizeHost(wildcard ? entry.slice(2) : entry);
    return { host, wildcard };
  });
  return rules.filter(
    (rule, index) => rules.findIndex((candidate) => candidate.host === rule.host && candidate.wildcard === rule.wildcard) === index,
  );
}

function primaryURL(value: string | undefined, rules: RouteRule[]): string {
  const candidate = value?.trim() || `https://${rules[0].host}`;
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("Primary Website URL must be a valid HTTP or HTTPS URL.");
  }
}

function getConfig(): Config {
  const preferences = getPreferenceValues<Preferences>();
  const routeRules = parseRouteRules(preferences.routedHosts);
  const services = preferences.networkServices
    ?.split(",")
    .map((service) => service.trim())
    .filter(Boolean);

  return {
    sshUser: preferences.sshUser.trim(),
    sshHost: preferences.sshHost.trim(),
    sshPort: parseInteger("SSH Port", preferences.sshPort, 1, 65535),
    identityFile: preferences.identityFile?.trim() ? expandHome(preferences.identityFile.trim()) : undefined,
    routedHosts: routeRules,
    primaryURL: primaryURL(preferences.primaryURL, routeRules),
    socksPort: parseInteger("Local SOCKS Port", preferences.socksPort, 1024, 65535),
    pacPort: parseInteger("Local PAC Port", preferences.pacPort, 1024, 65535),
    startTimeoutMs: parseInteger("Start Timeout", preferences.startTimeout, 1, 120) * 1000,
    networkServices: services?.length ? services : undefined,
    openInSafari: preferences.openInSafari,
  };
}

function errorMessage(error: unknown): string {
  const detail = error as Error & { stdout?: string; stderr?: string };
  return (detail?.stderr || detail?.stdout || detail?.message || String(error)).trim();
}

async function execute(file: string, args: string[], timeout = 15_000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return (stdout || stderr).trim();
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

async function succeeds(file: string, args: string[], timeout = 5_000): Promise<boolean> {
  try {
    await execute(file, args, timeout);
    return true;
  } catch {
    return false;
  }
}

function pacURL(config: Config): string {
  const version = createHash("sha256")
    .update(JSON.stringify({ socksPort: config.socksPort, routedHosts: config.routedHosts }))
    .digest("hex")
    .slice(0, 12);
  return `http://127.0.0.1:${config.pacPort}/proxy.pac?v=${version}`;
}

function launchdTarget(label: string): string {
  return `gui/${process.getuid!()}/${label}`;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1_500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return check();
}

async function tunnelRunning(config: Config): Promise<boolean> {
  return (await succeeds(LAUNCHCTL, ["print", launchdTarget(SSH_LAUNCHD_LABEL)])) && (await isPortOpen(config.socksPort));
}

async function pacServerRunning(config: Config): Promise<boolean> {
  return (await succeeds(LAUNCHCTL, ["print", launchdTarget(PAC_LAUNCHD_LABEL)])) && (await isPortOpen(config.pacPort));
}

async function listNetworkServices(config: Config): Promise<string[]> {
  if (config.networkServices) return config.networkServices;
  const output = await execute(NETWORKSETUP, ["-listallnetworkservices"]);
  return output
    .split("\n")
    .slice(1)
    .map((service) => service.trimEnd())
    .filter((service) => service.length > 0 && !service.startsWith("*"));
}

async function getAutomaticProxy(service: string): Promise<SavedProxySetting> {
  const output = await execute(NETWORKSETUP, ["-getautoproxyurl", service]);
  const url = output.match(/^URL: (.*)$/m)?.[1] ?? "(null)";
  const enabled = output.match(/^Enabled: (.*)$/m)?.[1] === "Yes";
  return { service, url: url === "(null)" ? null : url, enabled };
}

async function routingConfigured(config: Config): Promise<boolean> {
  const services = await listNetworkServices(config);
  if (services.length === 0) return false;
  const settings = await Promise.all(services.map(getAutomaticProxy));
  const expectedURL = pacURL(config);
  return settings.every((setting) => setting.enabled && setting.url === expectedURL);
}

async function saveProxySettings(config: Config): Promise<void> {
  try {
    await fs.access(PROXY_BACKUP_FILE);
    return;
  } catch {
    // No existing backup; capture the current settings below.
  }

  const services = await listNetworkServices(config);
  if (services.length === 0) throw new Error("No enabled macOS network services were found.");
  const settings = await Promise.all(services.map(getAutomaticProxy));
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(PROXY_BACKUP_FILE, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx" });
}

async function restoreProxySettings(config: Config): Promise<void> {
  let settings: SavedProxySetting[];
  try {
    settings = JSON.parse(await fs.readFile(PROXY_BACKUP_FILE, "utf8")) as SavedProxySetting[];
  } catch (error) {
    const detail = error as NodeJS.ErrnoException;
    if (detail.code !== "ENOENT") throw new Error(`Could not read saved proxy settings: ${errorMessage(error)}`);

    // Recovery path for a crash before the backup was written: only disable
    // services that still point at this extension's localhost PAC endpoint.
    const services = await listNetworkServices(config);
    const current = await Promise.all(services.map(getAutomaticProxy));
    settings = current
      .filter((setting) => setting.url?.startsWith(`http://127.0.0.1:${config.pacPort}/proxy.pac`))
      .map((setting) => ({ ...setting, enabled: false }));
  }

  const errors: string[] = [];
  for (const setting of settings) {
    try {
      if (setting.url) {
        await execute(NETWORKSETUP, ["-setautoproxyurl", setting.service, setting.url]);
      }
      await execute(NETWORKSETUP, ["-setautoproxystate", setting.service, setting.enabled ? "on" : "off"]);
    } catch (error) {
      errors.push(`${setting.service}: ${errorMessage(error)}`);
    }
  }
  if (errors.length) throw new Error(`Could not restore proxy settings: ${errors.join("; ")}`);
  await fs.rm(PROXY_BACKUP_FILE, { force: true });
}

async function enableRouting(config: Config): Promise<void> {
  await saveProxySettings(config);
  const services = await listNetworkServices(config);
  try {
    for (const service of services) {
      await execute(NETWORKSETUP, ["-setautoproxyurl", service, pacURL(config)]);
      await execute(NETWORKSETUP, ["-setautoproxystate", service, "on"]);
    }
  } catch (error) {
    await restoreProxySettings(config);
    throw error;
  }
}

async function writePacFile(config: Config): Promise<void> {
  const conditions = config.routedHosts.map((rule) =>
    rule.wildcard
      ? `(host === ${JSON.stringify(rule.host)} || dnsDomainIs(host, ${JSON.stringify(`.${rule.host}`)}))`
      : `host === ${JSON.stringify(rule.host)}`,
  );
  const script = [
    "function FindProxyForURL(url, host) {",
    "  host = host.toLowerCase();",
    `  if (${conditions.join(" ||\n      ")}) {`,
    `    return "SOCKS 127.0.0.1:${config.socksPort}";`,
    "  }",
    '  return "DIRECT";',
    "}",
    "",
  ].join("\n");
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(PAC_FILE, script);
}

async function startPacServer(config: Config): Promise<void> {
  await writePacFile(config);
  await fs.mkdir(path.dirname(PAC_LAUNCH_AGENT_FILE), { recursive: true });

  if (await succeeds(LAUNCHCTL, ["print", launchdTarget(PAC_LAUNCHD_LABEL)])) {
    await succeeds(LAUNCHCTL, ["bootout", launchdTarget(PAC_LAUNCHD_LABEL)]);
  }

  const argumentsList = [PYTHON, "-m", "http.server", String(config.pacPort), "--bind", "127.0.0.1", "--directory", STATE_DIR];
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    "  <key>Label</key>",
    `  <string>${PAC_LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key><array>",
    ...argumentsList.map((argument) => `    <string>${xmlEscape(argument)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>KeepAlive</key><true/>",
    "  <key>ProcessType</key><string>Background</string>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(PAC_LOG_FILE)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(PAC_LOG_FILE)}</string>`,
    "</dict></plist>",
    "",
  ].join("\n");

  await fs.writeFile(PAC_LAUNCH_AGENT_FILE, plist);
  await execute(LAUNCHCTL, ["bootstrap", `gui/${process.getuid!()}`, PAC_LAUNCH_AGENT_FILE]);
  if (!(await waitUntil(() => pacServerRunning(config), 5_000))) {
    throw new Error(`The local PAC server did not start on port ${config.pacPort}.`);
  }
}

async function stopPacServer(): Promise<void> {
  if (await succeeds(LAUNCHCTL, ["print", launchdTarget(PAC_LAUNCHD_LABEL)])) {
    await succeeds(LAUNCHCTL, ["bootout", launchdTarget(PAC_LAUNCHD_LABEL)]);
  }
  await fs.rm(PAC_LAUNCH_AGENT_FILE, { force: true });
}

async function startTunnel(config: Config): Promise<boolean> {
  if (await tunnelRunning(config)) return false;
  if (await isPortOpen(config.socksPort)) {
    throw new Error(`Port ${config.socksPort} is already in use by another process.`);
  }

  if (await succeeds(LAUNCHCTL, ["print", launchdTarget(SSH_LAUNCHD_LABEL)])) {
    await succeeds(LAUNCHCTL, ["bootout", launchdTarget(SSH_LAUNCHD_LABEL)]);
  }

  const argumentsList = [
    SSH,
    "-p",
    String(config.sshPort),
    "-D",
    `127.0.0.1:${config.socksPort}`,
    "-N",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
  ];
  if (config.identityFile) argumentsList.push("-i", config.identityFile);
  argumentsList.push(`${config.sshUser}@${config.sshHost}`);

  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    "  <key>Label</key>",
    `  <string>${SSH_LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key><array>",
    ...argumentsList.map((argument) => `    <string>${xmlEscape(argument)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>KeepAlive</key><true/>",
    "  <key>ThrottleInterval</key><integer>10</integer>",
    "  <key>ProcessType</key><string>Background</string>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(SSH_LOG_FILE)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(SSH_LOG_FILE)}</string>`,
    "</dict></plist>",
    "",
  ].join("\n");

  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.mkdir(path.dirname(SSH_LAUNCH_AGENT_FILE), { recursive: true });
  await fs.writeFile(SSH_LAUNCH_AGENT_FILE, plist);
  await execute(LAUNCHCTL, ["bootstrap", `gui/${process.getuid!()}`, SSH_LAUNCH_AGENT_FILE]);
  const ready = await waitUntil(() => tunnelRunning(config), config.startTimeoutMs);
  if (!ready) {
    await stopTunnel(config);
    throw new Error(`The SSH tunnel did not become ready on port ${config.socksPort}.`);
  }
  return true;
}

async function stopTunnel(_config: Config): Promise<void> {
  if (await succeeds(LAUNCHCTL, ["print", launchdTarget(SSH_LAUNCHD_LABEL)])) {
    await succeeds(LAUNCHCTL, ["bootout", launchdTarget(SSH_LAUNCHD_LABEL)]);
  }
  await fs.rm(SSH_LAUNCH_AGENT_FILE, { force: true });
}

export function getPrimaryURL(): string {
  return getConfig().primaryURL;
}

export function getRoutedWebsites(): RoutedWebsite[] {
  const config = getConfig();
  const primaryHost = new URL(config.primaryURL).hostname;
  const websites: RoutedWebsite[] = [{ title: primaryHost, url: config.primaryURL }];
  for (const rule of config.routedHosts) {
    const title = rule.wildcard ? `*.${rule.host}` : rule.host;
    const url = `https://${rule.host}`;
    if (!websites.some((website) => website.title === title || website.url === url)) websites.push({ title, url });
  }
  return websites;
}

export function shouldOpenInSafari(): boolean {
  return getConfig().openInSafari;
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  const config = getConfig();
  const [sshAgent, socksPort, pacServer, routing] = await Promise.all([
    succeeds(LAUNCHCTL, ["print", launchdTarget(SSH_LAUNCHD_LABEL)]),
    isPortOpen(config.socksPort),
    pacServerRunning(config),
    routingConfigured(config),
  ]);
  const tunnel = sshAgent && socksPort;
  const running = tunnel && pacServer && routing;
  const degraded = !running && (sshAgent || socksPort || pacServer || routing);
  const detail = running
    ? `Running — ${config.routedHosts.length} host rule${config.routedHosts.length === 1 ? " uses" : "s use"} SOCKS on localhost:${config.socksPort}.`
    : degraded
      ? `Degraded — tunnel ${tunnel ? "on" : "off"}, PAC ${pacServer ? "on" : "off"}, routing ${routing ? "on" : "off"}.`
      : "Stopped — all websites use the normal network route.";
  return { running, degraded, detail, tunnel, pacServer, routing };
}

export async function startProxy(): Promise<string> {
  const config = getConfig();
  const alreadyRunning = await getProxyStatus();
  if (alreadyRunning.running) return `Already running with ${config.routedHosts.length} routed host rule${config.routedHosts.length === 1 ? "" : "s"}.`;

  let startedTunnel = false;
  try {
    startedTunnel = await startTunnel(config);
    await startPacServer(config);
    await enableRouting(config);
  } catch (error) {
    try {
      await restoreProxySettings(config);
    } catch {
      // Keep the original startup error.
    }
    await stopPacServer();
    if (startedTunnel) await stopTunnel(config);
    throw new Error(`Could not start SSH Proxy Router: ${errorMessage(error)}`);
  }

  return `Running — ${config.routedHosts.length} host rule${config.routedHosts.length === 1 ? "" : "s"} routed through SSH.`;
}

export async function stopProxy(): Promise<string> {
  const config = getConfig();
  const errors: string[] = [];
  try {
    await restoreProxySettings(config);
  } catch (error) {
    errors.push(errorMessage(error));
  }
  try {
    await stopPacServer();
  } catch (error) {
    errors.push(errorMessage(error));
  }
  try {
    await stopTunnel(config);
  } catch (error) {
    errors.push(errorMessage(error));
  }
  if (errors.length) throw new Error(`Could not fully stop SSH Proxy Router: ${errors.join("; ")}`);
  return "Stopped — previous macOS proxy settings restored.";
}

export async function toggleProxy(): Promise<{ running: boolean; message: string }> {
  const status = await getProxyStatus();
  if (status.running) return { running: false, message: await stopProxy() };
  return { running: true, message: await startProxy() };
}

export async function testProxy(): Promise<string> {
  const config = getConfig();
  const status = await getProxyStatus();
  if (!status.running) throw new Error(status.detail);
  const targets = [config.primaryURL];
  for (const rule of config.routedHosts.filter((rule) => !rule.wildcard)) {
    const url = `https://${rule.host}`;
    if (!targets.some((target) => new URL(target).hostname === rule.host)) targets.push(url);
  }
  for (const target of targets) {
    await execute(
      CURL,
      [
        "--socks5-hostname",
        `127.0.0.1:${config.socksPort}`,
        "--silent",
        "--show-error",
        "--max-time",
        "20",
        "--output",
        "/dev/null",
        target,
      ],
      25_000,
    );
  }
  return `${targets.length} routed website${targets.length === 1 ? "" : "s"} responded through localhost:${config.socksPort}.`;
}
