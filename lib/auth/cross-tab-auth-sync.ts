// Cross-tab auth state broadcaster (T-316).
//
// Le storage adapter Supabase utilisé via @supabase/ssr createBrowserClient
// (cf. lib/supabase/client.ts) persiste la session en cookies. Les cookies
// ne déclenchent PAS de `storage` event cross-tab, donc le listener
// onAuthStateChange câblé dans UserProvider n'est PAS notifié quand un
// autre tab login/logout. Conséquence : tab A logout → tab B reste sur
// l'ancien state user (stale) jusqu'au refresh manuel.
//
// On comble le gap en relayant explicitement les events identité via
// BroadcastChannel API : tab émetteur appelle broadcast() après chaque
// SIGNED_IN/SIGNED_OUT/USER_UPDATED/PASSWORD_RECOVERY local, tabs récepteurs
// reçoivent l'event via subscribe() et déclenchent un getSession() pour
// re-synchroniser leur state.
//
// Module pur : aucune dépendance React/Supabase, testable en environnement
// node avec mock global BroadcastChannel.
//
// Fallback no-op silencieux si BroadcastChannel indisponible (SSR, vieux
// navigateurs IE11/Safari < 15.4) — broadcast() et subscribe() ne throw
// jamais, le listener onAuthStateChange intra-tab continue de fonctionner.

const DEFAULT_CHANNEL_NAME = "terroir-auth-sync";
const EVENT_TYPE = "auth-changed";

interface AuthSyncMessage {
  type: typeof EVENT_TYPE;
}

export interface AuthBroadcaster {
  broadcast: () => void;
  subscribe: (handler: () => void) => () => void;
  close: () => void;
}

export function createAuthBroadcaster(
  channelName: string = DEFAULT_CHANNEL_NAME,
): AuthBroadcaster {
  if (typeof BroadcastChannel === "undefined") {
    return {
      broadcast: () => {},
      subscribe: () => () => {},
      close: () => {},
    };
  }

  const channel = new BroadcastChannel(channelName);
  let closed = false;

  return {
    broadcast: () => {
      if (closed) return;
      const message: AuthSyncMessage = { type: EVENT_TYPE };
      channel.postMessage(message);
    },
    subscribe: (handler: () => void) => {
      const listener = (event: MessageEvent) => {
        const data = event.data as AuthSyncMessage | undefined;
        if (data?.type === EVENT_TYPE) handler();
      };
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    close: () => {
      if (closed) return;
      closed = true;
      channel.close();
    },
  };
}
