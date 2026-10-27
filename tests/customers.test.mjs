import test from "node:test";
import assert from "node:assert/strict";
import { filterCustomers, rankCustomers } from "../src/lib/customers.js";

const customers = [
  { id: 1, name: "María López", document: "102030", total_purchases: 50000 },
  { id: 2, name: "Carlos Pérez", document: "998877", total_purchases: 120000 },
  { id: 3, name: "Ana Gómez", document: "445566", total_purchases: 80000 },
];

test("el selector encuentra clientes por nombre sin depender de tildes", () => {
  assert.deepEqual(filterCustomers(customers, "maria").map((item) => item.id), [1]);
});

test("el selector encuentra clientes por cedula", () => {
  assert.deepEqual(filterCustomers(customers, "998877").map((item) => item.id), [2]);
});

test("F5 ordena primero los clientes que mas compran", () => {
  assert.deepEqual(rankCustomers(customers).map((item) => item.id), [2, 3, 1]);
});
