import { normalize } from "./format.js";

const searchable = (value) =>
  normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Excel imports keep traceability in description (for example
// "Importado desde Excel, fila 737. UM original: un"). That text is useful
// for auditing, but it must not make searches such as "ORIGINAL" match every
// imported product.
const commercialDescription = (value) =>
  searchable(value).startsWith("importado desde excel") ? "" : value;

export const productSearchTerms = (query) =>
  searchable(query)
    .split(" ")
    .filter(Boolean);

export function matchesProductSearch(product, query) {
  // An asterisk separates remembered fragments: SHA* ORI* => SHA AND ORI.
  // Plain partial searches keep the same behaviour, so the asterisk is
  // optional rather than required.
  const terms = productSearchTerms(query);
  if (!terms.length) return true;
  const text = searchable(
    [
      product?.name,
      product?.sku,
      product?.barcode,
      commercialDescription(product?.description),
      product?.category,
    ].join(" "),
  );
  return terms.every((term) => text.includes(term));
}
