import { getTableName } from "drizzle-orm";

/**
 * Banco falso para testes: cada consulta vira um `Query` simples e o teste decide a resposta
 * em `fake.handler`. Também serve ao `db.batch` (executa cada item do lote).
 */
export type Query = {
  kind: "select" | "insert" | "update" | "delete";
  table: string;
  joins: string[];
  values?: Record<string, unknown>;
  set?: Record<string, unknown>;
  conflict: boolean;
  returning: boolean;
};

export const fake = {
  queries: [] as Query[],
  batches: [] as Query[][],
  handler: (_q: Query): unknown => [] as unknown[],
  reset() {
    this.queries = [];
    this.batches = [];
    this.handler = () => [];
  },
};

function builder(kind: Query["kind"], table?: unknown) {
  const query: Query = {
    kind,
    table: table ? getTableName(table as never) : "",
    joins: [],
    conflict: false,
    returning: false,
  };
  const b: Record<string, unknown> = { query };
  const self = () => b;
  Object.assign(b, {
    select: self,
    from(t: unknown) {
      query.table = getTableName(t as never);
      return b;
    },
    innerJoin(t: unknown) {
      query.joins.push(getTableName(t as never));
      return b;
    },
    where: self,
    limit: self,
    orderBy: self,
    values(v: Record<string, unknown>) {
      query.values = v;
      return b;
    },
    set(v: Record<string, unknown>) {
      query.set = v;
      return b;
    },
    onConflictDoNothing() {
      query.conflict = true;
      return b;
    },
    returning() {
      query.returning = true;
      return b;
    },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      fake.queries.push(query);
      return Promise.resolve()
        .then(() => fake.handler(query))
        .then(resolve, reject);
    },
    catch(reject: (e: unknown) => unknown) {
      return (b.then as (r: undefined, j: (e: unknown) => unknown) => Promise<unknown>)(undefined, reject);
    },
  });
  return b;
}

export function makeDbModule() {
  return {
    db: {
      select: () => builder("select"),
      insert: (t: unknown) => builder("insert", t),
      update: (t: unknown) => builder("update", t),
      delete: (t: unknown) => builder("delete", t),
      batch: async (items: { query: Query }[]) => {
        fake.batches.push(items.map((i) => i.query));
        return items.map((i) => fake.handler(i.query));
      },
    },
  };
}
