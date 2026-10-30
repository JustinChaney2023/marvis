"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getPushPublicKeyAction,
  listPushDevicesAction,
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "../actions";
import Button from "../ui/Button";

type Device = { id: string; label: string | null; createdAt: Date; endpoint: string };

// "unsupported" covers both no-API browsers and iOS Safari outside an
// installed Home Screen app (where PushManager simply doesn't exist).
type Support = "pending" | "unsupported" | "ios-needs-install" | "ok";

function detectSupport(): Support {
  if (typeof window === "undefined") return "pending";
  const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (hasApis) return "ok";
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return isIos ? "ios-needs-install" : "unsupported";
}

const noopSubscribe = () => () => {};

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function guessDeviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${device} · ${browser}` : device;
}

/**
 * Turns on Web Push for this browser (src/lib/push.ts sends the actual
 * reminders) and lists every device that's opted in.
 */
export default function PushNotificationsManager() {
  const support = useSyncExternalStore(noopSubscribe, detectSupport, () => "pending" as Support);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => setDevices(await listPushDevicesAction());

  useEffect(() => {
    let cancelled = false;
    listPushDevicesAction().then((d) => {
      if (!cancelled) setDevices(d);
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setThisEndpoint(sub?.endpoint ?? null);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications are blocked for this site — allow them in your browser settings, then try again.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const publicKey = await getPushPublicKeyAction();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePushSubscriptionAction(json, guessDeviceLabel());
      setThisEndpoint(sub.endpoint);
      await refresh();
      const sent = await sendTestPushAction();
      setMessage(sent > 0 ? "On — a test notification is on its way." : "Saved, but the test notification didn't go through.");
    } catch (err) {
      console.error(err);
      setMessage("Couldn't turn notifications on in this browser.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (device: Device) => {
    await removePushSubscriptionAction(device.id);
    if (device.endpoint === thisEndpoint) {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      setThisEndpoint(null);
    }
    await refresh();
  };

  const thisDeviceOn = Boolean(thisEndpoint && devices?.some((d) => d.endpoint === thisEndpoint));

  return (
    <div className="flex flex-col gap-3 text-sm">
      {support === "ios-needs-install" && (
        <p className="rounded-lg border border-rule bg-paper p-3 text-xs text-ink-2">
          On iPhone and iPad, notifications work once Season is on your Home Screen: tap Share →{" "}
          <span className="font-medium">Add to Home Screen</span>, open Season from there, and come back here.
        </p>
      )}
      {support === "unsupported" && (
        <p className="text-xs text-muted">This browser doesn&apos;t support push notifications.</p>
      )}
      {support === "ok" && (
        <div className="flex flex-wrap items-center gap-2">
          {thisDeviceOn ? (
            <>
              <span className="text-ink-2">On for this device.</span>
              <Button
                type="button"
                variant="secondary"
                pending={busy}
                onClick={async () => {
                  setBusy(true);
                  const sent = await sendTestPushAction().finally(() => setBusy(false));
                  setMessage(sent > 0 ? "Test sent." : "No device received it.");
                }}
              >
                Send a test
              </Button>
            </>
          ) : (
            <Button type="button" pending={busy} onClick={enable}>
              Turn on for this device
            </Button>
          )}
        </div>
      )}
      {message && <p className="text-xs text-ink-2">{message}</p>}

      {devices && devices.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-rule px-3 py-2">
              <span className="min-w-0 truncate text-ink">
                {d.label ?? "Device"}
                {d.endpoint === thisEndpoint && <span className="ml-1 text-xs text-muted">(this one)</span>}
              </span>
              <button type="button" onClick={() => remove(d)} className="text-xs text-muted hover:text-accent">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
