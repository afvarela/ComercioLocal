import { useEffect, useMemo, useRef, useState } from "react";
import { searchProducts } from "./api.js";
import { matchesProductSearch } from "./productSearch.js";

export function useProductSearch(business, catalog, query, limit = 90) {
  const text = String(query || "").trim();
  const local = useMemo(
    () => (catalog || []).filter((product) => matchesProductSearch(product, text)).slice(0, limit),
    [catalog, text, limit],
  );
  const [remote, setRemote] = useState({ query: "", products: null });
  const sequence = useRef(0);

  useEffect(() => {
    const current = ++sequence.current;
    if (!text) {
      setRemote({ query: "", products: null });
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await searchProducts(business, text, { limit });
        if (sequence.current === current)
          setRemote({ query: text, products: result.products || [] });
      } catch {
        if (sequence.current === current) setRemote({ query: "", products: null });
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [business, text, limit]);

  async function exact(value) {
    const result = await searchProducts(business, value, { exact: true, limit: 1 });
    return result.products?.[0] || null;
  }

  return {
    products: text && remote.query === text ? remote.products : local,
    exact,
    remote: text && remote.query === text,
  };
}
