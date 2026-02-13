/**
 * Decimal.js wrapper — resolves "not constructable" with NodeNext moduleResolution.
 * Preserves exact numeric semantics. Re-export for use across the backend.
 */
import type { Decimal as D } from 'decimal.js';
import { createRequire } from 'module';

/** Instance type from decimal.js. Use for annotations: (x: DecimalInstance) */
export type DecimalInstance = D;

/** Constructor + static API used by the backend */
interface DecimalConstructor {
  new (value: D.Value): D;
  max(...n: D.Value[]): D;
  min(...n: D.Value[]): D;
  set(config: D.Config): DecimalConstructor;
  readonly ROUND_DOWN: 1;
  readonly ROUND_UP: 0;
  readonly ROUND_CEIL: 2;
  readonly ROUND_FLOOR: 3;
  readonly ROUND_HALF_UP: 4;
  readonly ROUND_HALF_DOWN: 5;
  readonly ROUND_HALF_EVEN: 6;
  readonly ROUND_HALF_CEIL: 7;
  readonly ROUND_HALF_FLOOR: 8;
}

const require = createRequire(import.meta.url);
const DecimalModule = require('decimal.js') as { default?: DecimalConstructor };
const Raw = DecimalModule.default ?? DecimalModule;

export const Decimal = Raw as DecimalConstructor;
