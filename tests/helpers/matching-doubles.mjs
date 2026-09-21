export const state = { tables: {}, calls: [], aiCalls: 0 };
export function client() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from(table) {
      const filters = [];
      let operation = "select",
        payload,
        single = false,
        orFilter;
      const q = {
        select() {
          return q;
        },
        eq(key, value) {
          filters.push([key, value]);
          return q;
        },
        order() {
          return q;
        },
        or(value) {
          orFilter = value;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        delete() {
          operation = "delete";
          return q;
        },
        upsert(value) {
          operation = "upsert";
          payload = value;
          return q;
        },
        insert(value) {
          operation = "insert";
          payload = value;
          return q;
        },
        then(resolve, reject) {
          state.calls.push({ table, filters, operation, orFilter, payload });
          let rows = state.tables[table] ?? [];
          const matches = (row) => filters.every(([k, v]) => row[k] === v);
          if (operation === "insert" || operation === "upsert") {
            rows.push({ id: "nova-analise", ...payload });
          } else if (operation === "delete") {
            state.tables[table] = rows.filter((row) => !matches(row));
          }
          rows = rows.filter(matches);
          if (orFilter) {
            const term = orFilter.match(/ilike\.%(.*?)%/)[1].toLowerCase();
            rows = rows.filter((row) =>
              ["titulo", "orgao", "modalidade", "cidade", "objeto"].some((k) =>
                row[k]?.toLowerCase().includes(term),
              ),
            );
          }
          return Promise.resolve({
            data: single ? (rows[0] ?? null) : rows,
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
