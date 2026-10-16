import { useEffect, useState } from "react";
import { api, ApiError, type AppState } from "./api";

// Counter actions; each success is reported as the Track Event `demo-<action>`.
type Action = "load" | "increment" | "decrement" | "reset" | "refresh";

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
function trackEvent(name: string, properties?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(`demo-${name}`, properties);
    } catch {
      // Swallow: a tracking failure must never break the UI or be reported as
      // a failed action by run()'s catch block.
    }
  }
}

// Properties for the success events. `next` is the server-confirmed state and
// `previousCounter` is the counter that was on screen when the action started.
function successProperties(action: Action, next: AppState, previousCounter: number) {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter };
    case "reset":
      // The counter is always 0 afterwards; what matters is how much was cleared.
      return { previousCounter };
    case "refresh":
      // The counter is shared by every visitor, so a refresh can surface changes
      // made elsewhere; counterChanged separates those from no-op refreshes.
      return {
        counter: next.counter,
        lastAction: next.lastAction,
        previousCounter,
        counterChanged: next.counter !== previousCounter,
      };
  }
}

// Module-level flag so the initial load runs, and fires demo-load (or
// demo-action-failed), once per page load. React StrictMode re-runs mount
// effects in development builds, which would otherwise double-count it.
let initialLoadStarted = false;

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action, fn: () => Promise<AppState>) => {
    const previousCounter = state.counter;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      trackEvent(action, successProperties(action, next, previousCounter));
    } catch (e) {
      const err = e as Error;
      setError(err.message);
      // demo-action-failed: errorType is "TypeError" for network/CORS failures
      // and "Error" for non-2xx responses, which also carry httpStatus. The
      // message is capped to stay within Pendo's 512-byte properties limit.
      trackEvent("action-failed", {
        action,
        errorMessage: err.message.slice(0, 200),
        errorType: err.name,
        ...(err instanceof ApiError && { httpStatus: err.status }),
      });
    }
  };

  useEffect(() => {
    if (initialLoadStarted) return;
    initialLoadStarted = true;
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
