/**
 * Banco falso para testes: cada tabela devolve as linhas programadas (valor ou função),
 * e toda escrita fica registrada em `writes`. Usado com vi.mock("@/infra/db", ...).
 */
export type Write = { op: string; table: unknown; values?: unknown; set?: unknown };
type Rows = unknown[] | (() => unknown[]);

export function createFakeDb() {
  const rows = new Map<unknown, Rows>();
  const writes: Write[] = [];

  const chain = (op: string, table?: unknown) => {
    const entry: Write = { op, table };
    const api: Record<string, unknown> = {};
    for (const m of ["leftJoin", "innerJoin", "where", "orderBy", "limit", "onConflictDoNothing", "onConflictDoUpdate", "returning"]) {
      api[m] = () => api;
    }
    api.from = (t: unknown) => {
      entry.table = t;
      return api;
    };
    api.values = (v: unknown) => {
      entry.values = v;
      return api;
    };
    api.set = (v: unknown) => {
      entry.set = v;
      return api;
    };
    api.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (op !== "select") writes.push(entry);
      const r = rows.get(entry.table);
      return Promise.resolve(typeof r === "function" ? r() : (r ?? [])).then(resolve, reject);
    };
    // Os query builders do drizzle são promises completas (inclui .catch).
    api.catch = (reject: (e: unknown) => unknown) =>
      (api.then as (a: unknown, b: unknown) => Promise<unknown>)(undefined, reject);
    return api;
  };

  const db = {
    select: () => chain("select"),
    insert: (t: unknown) => chain("insert", t),
    update: (t: unknown) => chain("update", t),
    delete: (t: unknown) => chain("delete", t),
    batch: async () => [],
  };
  return { db, rows, writes };
}
