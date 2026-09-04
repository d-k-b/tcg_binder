export function ownershipCondition(snapshotResponse, failure = null) {
  if (failure) {
    return {
      status: "CONDITIONAL",
      reasonCodes: [failure.code || "COLLECTION_AUTHORITY_UNAVAILABLE"],
      mayInferMissing: false
    };
  }
  const status = snapshotResponse && snapshotResponse.authority && snapshotResponse.authority.consumerStatus;
  if (status !== "AUTHORITATIVE") {
    return {
      status: "CONDITIONAL",
      reasonCodes: snapshotResponse && snapshotResponse.authority && snapshotResponse.authority.degradedReasonCodes || ["COLLECTION_AUTHORITY_UNAVAILABLE"],
      mayInferMissing: false
    };
  }
  return { status: "AUTHORITATIVE", reasonCodes: [], mayInferMissing: true };
}

export function projectInventoryDigest(inventoryRows, snapshotResponse, failure = null) {
  if (!Array.isArray(inventoryRows)) throw new Error("inventoryRows must be an array");
  const ownership = ownershipCondition(snapshotResponse, failure);
  return {
    schema: "tcg.monitor-ownership-consumer-fixture/v1",
    ownership,
    inventoryRows: inventoryRows.map((row) => ({
      ...row,
      ownershipStatus: ownership.status,
      recommendationStatus: ownership.status === "AUTHORITATIVE" ? row.recommendationStatus : "review-only"
    }))
  };
}
