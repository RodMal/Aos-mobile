// Geometry in inches: base footprints, edge-to-edge distances, coherency and unit formations.
// Copied from BSData-parser (packages/aos-deployment, packages/aos-maps) at commit 1d8e554.
export * from './units.js';
export * from './polygon.js';
export * from './footprint.js';
export * from './geometry.js';
export * from './coherency.js';
export {
  clearFormationCache,
  effectiveFrontage,
  layoutFormation,
  normaliseDeg,
  warmFormation,
  type FormationOptions,
} from './formation.js';
