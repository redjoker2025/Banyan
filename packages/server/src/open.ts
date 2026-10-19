import { spawn } from 'node:child_process'

/** Open a URL in the default browser, platform-agnostic, best-effort. */
export function openBrowser(url: string): void {
  try {
    switch (process.platform) {
      case 'win32':
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
        break
      case 'darwin':
        spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
        break
      default:
        spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch {
    // best effort only — the URL is printed to the console anyway
  }
}
