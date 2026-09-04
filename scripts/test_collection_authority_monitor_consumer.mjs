#!/usr/bin/env node

import assert from "node:assert/strict";
import { projectInventoryDigest } from "./lib/collection_authority_monitor_consumer.mjs";

const inventory = [
  { productId: "mtg:fixture:one", title: "Exact current listing one", recommendationStatus: "recommended" },
  { productId: "mtg:fixture:two", title: "Exact current listing two", recommendationStatus: "conditional" }
];
const stale = {
  authority: { consumerStatus: "CONDITIONAL", degradedReasonCodes: ["COLLECTION_SNAPSHOT_STALE"] }
};
const staleDigest = projectInventoryDigest(inventory, stale);
assert.equal(staleDigest.inventoryRows.length, 2, "stale ownership must not erase inventory rows");
assert(staleDigest.inventoryRows.every((row) => row.ownershipStatus === "CONDITIONAL" && row.recommendationStatus === "review-only"));
assert.equal(staleDigest.ownership.mayInferMissing, false);

const failedDigest = projectInventoryDigest(inventory, null, { code: "COLLECTION_SNAPSHOT_INCOMPLETE" });
assert.equal(failedDigest.inventoryRows.length, 2, "failed ownership must not render an empty digest");
assert(failedDigest.inventoryRows.every((row) => row.ownershipStatus === "CONDITIONAL" && row.recommendationStatus === "review-only"));
assert.deepEqual(failedDigest.ownership.reasonCodes, ["COLLECTION_SNAPSHOT_INCOMPLETE"]);

console.log("Collection authority monitor-consumer fixture passed (conditional inventory retained)");
