/**
 * The order a restore may clear and load tables in, computed from the
 * schema's own foreign-key constraints. No database access lives here; the
 * caller reads pg_constraint and hands the edges over.
 *
 * The order this replaced was EXPORT_TABLES read forwards for inserts and
 * backwards for deletes — a hand-maintained list standing in for a foreign-key
 * graph that holds 232 edges in a live company schema. The live restore proved
 * the list wrong on its first run (acc_account is listed before acc_tax_code,
 * which it references), and that contradiction was one of twelve. A list
 * cannot be reviewed against 232 edges; the constraints themselves can.
 */

/** One foreign-key constraint, as read from the catalog of the live schema. */
export interface ForeignKeyConstraint {
  constraintName: string;
  /** The table holding the foreign-key columns — the dependent side. */
  fromTable: string;
  /** The table those columns reference. */
  toTable: string;
  /** The referencing columns on fromTable, in constraint order. */
  columns: string[];
  /**
   * Whether every referencing column is nullable. Only such a constraint can
   * be suspended to break a cycle: rows load with the columns null and get the
   * real values written back once every table is in place.
   */
  allNullable: boolean;
}

export interface RestoreOrder {
  /**
   * Referenced tables before referencing ones. Load top-down; clear bottom-up
   * — one sort serves both directions, so they cannot drift apart.
   */
  order: string[];
  /**
   * Constraints no order can satisfy because they sit in a reference cycle.
   * Each is fully nullable (anything else is refused), so the caller nulls
   * these columns before clearing seed rows, loads with them null, and writes
   * the snapshot's values back after the last table — where the constraint
   * itself checks them.
   */
  suspended: ForeignKeyConstraint[];
}

export class RestoreOrderError extends Error {}

/**
 * Orders `tables` so that every foreign key between two of them points
 * backwards in the list.
 *
 * Self-references are ignored: the order of two tables can say nothing about
 * rows inside one, and the loader's single-statement insert already handles
 * that (foreign keys are checked at end of statement). Constraints touching a
 * table outside the set are ignored too — rows there are never cleared or
 * loaded, so they cannot constrain this order.
 *
 * Ties keep the input order, which makes the result deterministic and lets
 * the caller pass EXPORT_TABLES order as the familiar baseline.
 *
 * When the remaining tables all wait on each other — a genuine cycle — the
 * first one whose blocking constraints are all fully nullable has them
 * suspended and is emitted; a cycle that crosses a NOT NULL column has no
 * such way out and is refused. Suspension happens only at that point, never
 * pre-emptively, so a nullable edge an order *can* satisfy is always
 * satisfied by ordering.
 */
export function restoreOrder(
  tables: readonly string[],
  constraints: readonly ForeignKeyConstraint[],
): RestoreOrder {
  const pending = new Set(tables);
  const relevant = constraints.filter(
    (constraint) =>
      constraint.fromTable !== constraint.toTable &&
      pending.has(constraint.fromTable) &&
      pending.has(constraint.toTable),
  );
  const placed = new Set<string>();
  const suspendedSet = new Set<ForeignKeyConstraint>();
  const order: string[] = [];
  const suspended: ForeignKeyConstraint[] = [];

  const blockers = (table: string) =>
    relevant.filter(
      (constraint) =>
        constraint.fromTable === table &&
        !placed.has(constraint.toTable) &&
        !suspendedSet.has(constraint),
    );

  while (pending.size > 0) {
    let progressed = false;
    for (const table of tables) {
      if (!pending.has(table)) continue;
      if (blockers(table).length === 0) {
        order.push(table);
        placed.add(table);
        pending.delete(table);
        progressed = true;
      }
    }
    if (progressed) continue;
    // Every remaining table references another remaining table, so the
    // remainder holds a cycle. Break it at the first table (input order,
    // for determinism) whose blockers can all be suspended.
    const breakable = tables.find(
      (table) => pending.has(table) && blockers(table).every((c) => c.allNullable),
    );
    if (breakable === undefined) {
      throw new RestoreOrderError(
        `These tables reference each other in a cycle no load order can satisfy, and every ` +
          `way through it crosses a NOT NULL column, which cannot be suspended: ` +
          `${[...pending].join(", ")}.`,
      );
    }
    for (const constraint of blockers(breakable)) {
      suspendedSet.add(constraint);
      suspended.push(constraint);
    }
    // The next pass emits `breakable` first: its blockers are now suspended.
  }

  return { order, suspended };
}
