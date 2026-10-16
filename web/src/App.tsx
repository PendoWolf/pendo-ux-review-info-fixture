import { useEffect, useState } from "react";
import { api, HttpError, type AppState } from "./api";

type Action = "load" | "increment" | "decrement" | "reset" | "refresh";

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
// Sent as `demo-${name}`: demo-load, demo-increment, demo-decrement,
// demo-reset, demo-refresh, and demo-action-failed when any of them fails.
function trackEvent(name: Action | "action-failed", props: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    try {
      window.pendo?.track?.(`demo-${name}`, props);
    } catch {
      // Analytics must never break an action or be reported as its failure.
    }
  }
}

// The initial load runs from a mount effect, which StrictMode runs twice in
// development. Its outcome is reported once per page load; module scope (not
// component state) so a remount can't reset the flag.
let loadReported = false;

function shouldReport(name: Action) {
  if (name !== "load") return true;
  if (loadReported) return false;
  loadReported = true;
  return true;
}

// Properties for each action's success event. `previous` is what was on screen
// when the action started; `next` is the state the server returned.
function successProps(name: Action, previous: AppState, next: AppState, hadError: boolean) {
  switch (name) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      return { counter: next.counter, previousCounter: previous.counter };
    case "reset":
      // The counter is always 0 afterwards, so send what was cleared instead.
      return { previousCounter: previous.counter, previousLastAction: previous.lastAction };
    case "refresh":
      return {
        counter: next.counter,
        previousCounter: previous.counter,
        lastAction: next.lastAction,
        valueChanged: next.counter !== previous.counter,
        recoveredFromError: hadError,
      };
  }
}

// How an api call failed: HttpError is a non-2xx response, res.json() rejects
// with a SyntaxError when the body isn't JSON, and anything else is fetch()
// itself rejecting (offline, DNS, CORS, or a misconfigured VITE_API_URL).
function errorType(e: unknown) {
  if (e instanceof HttpError) return "http";
  if (e instanceof Error && e.name === "SyntaxError") return "parse";
  return "network";
}

function failureProps(name: Action, e: unknown) {
  const props: Record<string, unknown> = {
    action: name,
    errorType: errorType(e),
    errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 100),
  };
  if (e instanceof HttpError) props.httpStatus = e.status;
  return props;
}

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (name: Action, fn: () => Promise<AppState>) => {
    // Captured before the call: what the user was looking at when they acted.
    const previous = state;
    const hadError = error !== null;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      if (shouldReport(name)) trackEvent(name, successProps(name, previous, next, hadError));
    } catch (e) {
      setError((e as Error).message);
      if (shouldReport(name)) trackEvent("action-failed", failureProps(name, e));
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
