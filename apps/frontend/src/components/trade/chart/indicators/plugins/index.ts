/**
 * Phase B — indicator plugins (EMA/VWAP², overlay dropdown, RSI pane, volume MA).
 * Orchestration remains in `LightweightChartsAdapter`.
 */

export type {
  LineOverlayPluginContext,
  ModularExtensionPatch,
  PricePaneOverlayPlugin,
} from './pluginTypes';
export { ModularEmaVwapPlugin } from './ModularEmaVwapPlugin';
export { OverlayStudyPlugin } from './OverlayStudyPlugin';
export { RsiPanePlugin } from './RsiPanePlugin';
export { VolumeMaPlugin } from './VolumeMaPlugin';
