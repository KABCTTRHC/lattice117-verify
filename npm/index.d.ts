/** A single stop on a route. */
export interface Stop {
  /** Identifier echoed back in results. */
  id: string;
  /** Window opens. Same unit as everything else. Defaults to 0. */
  open?: number;
  /** Window closes. Same unit as everything else. */
  close: number;
  /**
   * Travel time from the PREVIOUS stop. Ignored on the first stop.
   * A fixed route only needs the legs actually driven — no distance matrix.
   */
  travel: number;
  /**
   * Optional load picked up or delivered here, in whole units (kilograms,
   * parcels, pallets). A route whose stops carry demand must state a capacity.
   */
  demand?: number;
}

/** One planned route. */
export interface Route {
  /** Vehicle, round or duty identifier. */
  id: string;
  /** Stops in visit order, at least two. */
  stops: Stop[];
  /** Departure time from the first stop. Defaults to 0. */
  depart?: number;
  /** Optional vehicle capacity, in the same whole units as `demand`. */
  capacity?: number;
  /** Alias of `capacity`. If both are given they must agree. */
  vehicleCapacity?: number;
}

/** A load that does not fit: the first stop whose demand takes the total past capacity. */
export interface CapacityViolation {
  stop: string;
  /** Running total at that stop. */
  load: number;
  capacity: number;
  /** `load - capacity`. */
  excess: number;
}

/** Why a route cannot be run as planned. */
export interface Violation {
  /** The stop that is reached too late. */
  stop: string;
  arrival: number;
  windowClose: number;
  /** How late, in the caller's own unit. */
  deficit: number;
  /** The underlying Q16.16 integers, for reproducibility checks. */
  raw: { arrival: number; windowClose: number; deficit: number };
}

export interface RouteResult {
  id: string;
  feasible: boolean;
  /** Total route cost when feasible, otherwise null. */
  cost: number | null;
  violation: Violation | null;
  /** Present only when the route states a capacity or a stop a demand. */
  load?: { total: number; capacity: number | null };
  /** Present only with `load`. Null when the load fits. */
  capacityViolation?: CapacityViolation | null;
}

export interface FleetResult {
  checked: number;
  feasible: number;
  infeasible: number;
  /** 0..1. The proportion of published rounds that are actually achievable. */
  feasibilityRate: number;
  routes: RouteResult[];
}

export declare const Q16_MAX: number;
export declare const Q16_MIN: number;
export declare const LOAD_MAX: number;

export declare function init(): Promise<WebAssembly.Exports>;
export declare function verifyRoute(route: Route): Promise<RouteResult>;
export declare function verifyFleet(routes: Route[]): Promise<FleetResult>;
export declare function verdictDigest(routes: Route[], result: FleetResult): Promise<string>;
