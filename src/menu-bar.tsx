import { MenuBarExtra, open, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import {
  getPrimaryURL,
  getProxyStatus,
  getRoutedWebsites,
  ProxyStatus,
  shouldOpenInSafari,
  startProxy,
  testProxy,
  toggleProxy,
} from "./proxy";

export default function Command() {
  const [status, setStatus] = useState<ProxyStatus>();
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setStatus(await getProxyStatus());
    } catch (error) {
      setStatus({
        running: false,
        degraded: true,
        detail: error instanceof Error ? error.message : String(error),
        tunnel: false,
        pacServer: false,
        routing: false,
      });
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle() {
    setIsLoading(true);
    try {
      const result = await toggleProxy();
      await showToast({
        style: Toast.Style.Success,
        title: result.running ? "SSH Proxy Router active" : "SSH Proxy Router stopped",
        message: result.message,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "SSH Proxy Router failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await refresh();
  }

  async function openWebsite(url: string) {
    const current = await getProxyStatus();
    if (!current.running) {
      setIsLoading(true);
      try {
        await startProxy();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not start SSH Proxy Router",
          message: error instanceof Error ? error.message : String(error),
        });
        await refresh();
        return;
      }
    }
    await open(url, shouldOpenInSafari() ? "com.apple.Safari" : undefined);
    await refresh();
  }

  async function test() {
    setIsLoading(true);
    try {
      const message = await testProxy();
      await showToast({ style: Toast.Style.Success, title: "Routed websites are reachable", message });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Website test failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await refresh();
  }

  const running = status?.running ?? false;
  const degraded = status?.degraded ?? false;
  const routedWebsites = getRoutedWebsites();

  return (
    <MenuBarExtra
      icon={running ? "active.svg" : "inactive.svg"}
      tooltip={status?.detail ?? "Checking SSH Proxy Router…"}
      isLoading={isLoading}
    >
      <MenuBarExtra.Item
        title={running ? "Website routing is active" : degraded ? "Website routing needs repair" : "Website routing is stopped"}
        subtitle={status?.detail}
        icon={running ? "active.svg" : "inactive.svg"}
        onAction={refresh}
      />
      <MenuBarExtra.Separator />
      <MenuBarExtra.Item
        title={running ? "Stop SSH Proxy Router" : degraded ? "Repair SSH Proxy Router" : "Start SSH Proxy Router"}
        icon={running ? "stop.svg" : "active.svg"}
        onAction={toggle}
      />
      <MenuBarExtra.Item title="Open Primary Website" icon="safari.svg" onAction={() => openWebsite(getPrimaryURL())} />
      <MenuBarExtra.Submenu title="Open Routed Website" icon="safari.svg">
        {routedWebsites.map((website) => (
          <MenuBarExtra.Item key={`${website.title}-${website.url}`} title={website.title} onAction={() => openWebsite(website.url)} />
        ))}
      </MenuBarExtra.Submenu>
      <MenuBarExtra.Item title="Test Routed Websites" icon="test.svg" onAction={test} />
      <MenuBarExtra.Separator />
      <MenuBarExtra.Item title="Extension Settings…" icon="refresh.svg" onAction={openExtensionPreferences} />
      <MenuBarExtra.Item title="Refresh Status" icon="refresh.svg" onAction={refresh} />
    </MenuBarExtra>
  );
}
