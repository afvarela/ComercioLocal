import { normalize } from "./format.js";

export function filterCustomers(customers, query, limit = 12) {
  const term = normalize(query).trim();
  return customers
    .filter((customer) => !term || normalize(`${customer.name} ${customer.document || ""}`).includes(term))
    .slice(0, limit);
}

export function rankCustomers(customers, query = "") {
  return filterCustomers(customers, query, customers.length)
    .sort((a, b) => Number(b.total_purchases || 0) - Number(a.total_purchases || 0));
}
