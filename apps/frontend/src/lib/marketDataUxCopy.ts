/**
 * Shared market-data labels and tooltips (dashboard, markets table, pair header, chart strip).
 * Wording only — no calculations.
 */

export const NO_TRADES_ACTIONABLE = 'No trades yet — start trading';

/** When the pair has no last trade at all (shorter contexts). */
export const NO_TRADES_SHORT = 'No trades yet';

export const NO_ACTIVITY_24H = 'No activity in last 24h';

/** Dashboard / chart strip (space-constrained). */
export const NO_ACTIVITY_SHORT = 'No activity';
export const NO_TRADES_TINY = 'No trades';

export const TOOLTIP_PAIR = 'Trading pair: base asset priced in the quote asset (e.g. BTC/USDT).';

export const TOOLTIP_LAST_PRICE = 'Latest traded price on this exchange for this pair.';

/** Explains the formula without implementing it (server-derived). */
export const TOOLTIP_24H_CHANGE =
  '24h change is the percent move from the first trade price in the rolling last 24 hours to the last price: ((last − open_24h) ÷ open_24h) × 100. Shown only when there were trades in that window.';

export const TOOLTIP_24H_HIGH =
  'Highest traded price recorded for this pair during the rolling last 24 hours.';

export const TOOLTIP_24H_LOW =
  'Lowest traded price recorded for this pair during the rolling last 24 hours.';

export const TOOLTIP_QUOTE_VOLUME_24H =
  'Quote volume (turnover): sum of (price × quantity) for all trades in the last 24 hours, expressed in the quote currency (e.g. USDT).';

export const TOOLTIP_BASE_VOLUME_24H =
  'Base volume: total units of the base asset traded in the last 24 hours.';

/** Shown when UI cannot show official server 24h % change (missing open/window). */
export const TOOLTIP_CHANGE_UNAVAILABLE = 'Official 24h change is unavailable for this snapshot (no rolling-window reference).';
