'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** When this changes (e.g. symbol), error UI clears so the chart can remount cleanly. */
  resetKey?: string;
};

type State = { hasError: boolean };

/**
 * Isolates chart/React render failures so the rest of the spot terminal keeps working in production.
 */
export class ChartErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ChartErrorBoundary]', error.message, info.componentStack);
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-amber-200/90 bg-amber-50/90 p-6 dark:border-amber-900/50 dark:bg-amber-950/25">
          <p className="max-w-sm text-center text-sm font-medium text-amber-900 dark:text-amber-100">
            Chart UI hit an unexpected error. Trading and orderbook below are unaffected.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
