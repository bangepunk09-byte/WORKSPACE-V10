import { useEffect, useState } from "react";

let globalDeferredPrompt =
  typeof window !== "undefined" ? window.__deferredPWAInstallPrompt || null : null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    globalDeferredPrompt = e;
    window.__deferredPWAInstallPrompt = e;
    window.dispatchEvent(new Event("pwa-prompt-ready"));
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(
    () => globalDeferredPrompt || (typeof window !== "undefined" ? window.__deferredPWAInstallPrompt : null)
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    const checkStandalone = () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      window.navigator.standalone === true;

    setIsInstalled(checkStandalone());

    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    if (!globalDeferredPrompt && window.__deferredPWAInstallPrompt) {
      globalDeferredPrompt = window.__deferredPWAInstallPrompt;
      setDeferredPrompt(window.__deferredPWAInstallPrompt);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      window.__deferredPWAInstallPrompt = e;
      setDeferredPrompt(e);
    };

    const handlePromptReady = () => {
      const readyPrompt = globalDeferredPrompt || window.__deferredPWAInstallPrompt;
      if (readyPrompt) {
        globalDeferredPrompt = readyPrompt;
        setDeferredPrompt(readyPrompt);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      globalDeferredPrompt = null;
      window.__deferredPWAInstallPrompt = null;
      setDeferredPrompt(null);
    };

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = () => setIsInstalled(checkStandalone());

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("pwa-prompt-ready", handlePromptReady);
    window.addEventListener("appinstalled", handleAppInstalled);
    mediaQuery.addEventListener?.("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("pwa-prompt-ready", handlePromptReady);
      window.removeEventListener("appinstalled", handleAppInstalled);
      mediaQuery.removeEventListener?.("change", handleDisplayModeChange);
    };
  }, []);

  const install = async () => {
    const promptEvent =
      deferredPrompt || globalDeferredPrompt || window.__deferredPWAInstallPrompt;
    if (!promptEvent) return false;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
        globalDeferredPrompt = null;
        window.__deferredPWAInstallPrompt = null;
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return {
    isInstallable: true,
    canNativeInstall: Boolean(deferredPrompt || globalDeferredPrompt),
    isInstalled,
    isIOS,
    isInIframe,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
