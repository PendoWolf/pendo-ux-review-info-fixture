import { useEffect, useState } from "react";
import { api, ApiError, type AppState } from "./api";

// Counter actions. Each fires the Track Event `demo-<action>` once the server
// confirms it; a failed call fires "demo-action-failed" instead.
type Action = "load" | "increment" | "decrement" | "reset" | "refresh";

// Pendo Track Event names. Pendo matches track types on the exact,
// case-sensitive name, so don't rename these.
type TrackEventName =
  | "demo-load"
  | "demo-increment"
  | "demo-decrement"
  | "demo-reset"
  | "demo-refresh"
  | "demo-action-failed";

type TrackProperties = Record<string, string | number | boolean>;

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
function trackEvent(name: TrackEventName, props?: TrackProperties) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(name, props);
    } catch (e) {
      // Never let analytics break the app or turn a success into a failure.
      console.warn("Pendo track failed", e);
    }
  }
}

// Properties for a confirmed action. `previous` is the state on screen when the
// user acted and `next` is the server's response. The counter is shared by all
// sessions, so a change other than +1/-1 means another session changed it too.
function successProperties(action: Action, previous: AppState, next: AppState): TrackProperties {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter: previous.counter };
    case "reset":
      // The counter is always 0 afterwards, so report what was cleared.
      return { previousCounter: previous.counter, previousLastAction: previous.lastAction };
    case "refresh":
      return {
        counter: next.counter,
        lastAction: next.lastAction,
        previousCounter: previous.counter,
        stateChanged: next.counter !== previous.counter || next.lastAction !== previous.lastAction,
      };
  }
}

// Properties for a failed action. httpStatus is only set when the server
// answered with a non-2xx status, so network/CORS failures are the ones
// without it.
function failureProperties(action: Action, e: unknown): TrackProperties {
  const message = e instanceof Error ? e.message : String(e);
  const props: TrackProperties = { action, errorMessage: message.slice(0, 200) };
  if (e instanceof ApiError) props.httpStatus = e.status;
  return props;
}

// React StrictMode runs the mount effect, and so the initial load, twice in
// development. Only the first initial-load outcome is reported, so dev and
// test runs count each page load once, like production builds do.
let initialLoadReported = false;

function trackOutcome(action: Action, name: TrackEventName, props: TrackProperties) {
  if (action === "load") {
    if (initialLoadReported) return;
    initialLoadReported = true;
  }
  trackEvent(name, props);
}

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action, fn: () => Promise<AppState>) => {
    const previous = state;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      trackOutcome(action, `demo-${action}`, successProperties(action, previous, next));
    } catch (e) {
      setError((e as Error).message);
      trackOutcome(action, "demo-action-failed", failureProperties(action, e));
    }
  };

  useEffect(() => {
    run("load", api.getState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>QAWolf Demo</h1>

      <p data-testid="counter-value" style={{ fontSize: "3rem", margin: "1rem 0" }}>
        {state.counter}
      </p>
      <p data-testid="last-action" style={{ color: "#666" }}>
        Last action: {state.lastAction}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button data-testid="btn-increment" onClick={() => run("increment", api.increment)}>
          Increment
        </button>
        <button data-testid="btn-decrement" onClick={() => run("decrement", api.decrement)}>
          Decrement
        </button>
        <button data-testid="btn-reset" onClick={() => run("reset", api.reset)}>
          Reset
        </button>
        <button data-testid="btn-refresh" onClick={() => run("refresh", api.getState)}>
          Refresh
        </button>
      </div>

      {error && (
        <p data-testid="error" style={{ color: "crimson", marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
