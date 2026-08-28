/*
 * Collection-state semantics shared by command-line and service adapters.
 *
 * This module deliberately contains no credentials, network calls, DOM access,
 * or filesystem writes.  It mirrors the generated dashboard's stable-key and
 * quantity rules so callers can test a mutation before a repository persists it.
 */
'use strict';

function norm(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function contentHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function keyFor(checklistId, item, slotIndex) {
  const slot = item.slots[slotIndex];
  if (!slot) throw new Error('Unknown slot index ' + slotIndex + ' for ' + item.name);
  const group = norm(slot.k || slot.g || slot.l);
  const ordinal = item.slots.slice(0, slotIndex)
    .filter((candidate) => norm(candidate.k || candidate.g || candidate.l) === group).length;
  return checklistId + '|v2|' + contentHash([
    norm(checklistId), norm(item.name), norm(item.code), group, ordinal,
  ].join('\u001f'));
}

function groupKeyFor(checklistId, item, group) {
  return checklistId + '|extra|' + contentHash([
    norm(checklistId), norm(item.name), norm(item.code), norm(group),
  ].join('\u001f'));
}

function slotExtraKeyFor(checklistId, item, slotIndex) {
  return checklistId + '|slot-extra|' + keyFor(checklistId, item, slotIndex).split('|').pop();
}

function displayGroupFor(item, slot) {
  const kidCopies = item.slots.length > 1 && item.slots
    .every((candidate) => /^Kid\s+\d+$/i.test(candidate.g || candidate.l || ''));
  return kidCopies ? 'Copies' : (slot.g || slot.l || '');
}

function groupSlots(item) {
  const groups = [];
  item.slots.forEach((slot, slotIndex) => {
    const name = displayGroupFor(item, slot);
    let group = groups.find((candidate) => candidate.name === name);
    if (!group) {
      group = { name, key: slot.k || name, slots: [] };
      groups.push(group);
    }
    group.slots.push({ slot, slotIndex });
  });
  return groups;
}

function emptyState(state = {}) {
  return {
    checks: { ...(state.checks || {}) },
    extras: { ...(state.extras || {}) },
    ordered: { ...(state.ordered || {}) },
    wrapperArts: { ...(state.wrapperArts || {}) },
    orderedWrapperArts: { ...(state.orderedWrapperArts || {}) },
    legacyChecksV1: { ...(state.legacyChecksV1 || {}) },
    keyVersion: state.keyVersion || 2,
  };
}

function positiveQuantity(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
}

function assertQuantity(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(field + ' must be a non-negative integer');
  }
}

function createCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.checklists)) throw new Error('Invalid binder catalog');
  const products = [];
  const byId = new Map();
  for (const checklist of catalog.checklists) {
    for (const era of checklist.eras || []) {
      for (const item of era.items || []) {
        for (const product of item.pricingProducts || []) {
          if (!product.ref || !product.ref.productId) continue;
          const entry = {
            checklist,
            item,
            product,
            ref: product.ref,
            groups: groupSlots(item),
          };
          products.push(entry);
          if (byId.has(product.ref.productId)) {
            throw new Error('Duplicate productId in catalog: ' + product.ref.productId);
          }
          byId.set(product.ref.productId, entry);
        }
      }
    }
  }
  return { catalog, products, byId };
}

function groupFor(entry) {
  const requested = norm(entry.product.slotGroup || entry.product.label);
  const group = entry.groups.find((candidate) => norm(candidate.name) === requested || norm(candidate.key) === requested);
  if (!group) {
    throw new Error('Catalog product ' + entry.ref.productId + ' has no matching slot group ' + (entry.product.slotGroup || entry.product.label));
  }
  return group;
}

function isDistinct(entry) {
  return entry.checklist.progressMode === 'distinct_variants';
}

function slotQuantity(state, entry, slotIndex) {
  const base = state.checks[keyFor(entry.checklist.id, entry.item, slotIndex)] ? 1 : 0;
  return base + positiveQuantity(state.extras[slotExtraKeyFor(entry.checklist.id, entry.item, slotIndex)]);
}

function orderedSlotQuantity(state, entry, slotIndex) {
  return positiveQuantity(state.ordered[slotExtraKeyFor(entry.checklist.id, entry.item, slotIndex)]);
}

function groupQuantity(state, entry, group = groupFor(entry)) {
  if (isDistinct(entry)) {
    return group.slots.reduce((total, member) => total + slotQuantity(state, entry, member.slotIndex), 0);
  }
  const checked = group.slots.filter((member) => state.checks[keyFor(entry.checklist.id, entry.item, member.slotIndex)]).length;
  return checked + positiveQuantity(state.extras[groupKeyFor(entry.checklist.id, entry.item, group.key)]);
}

function orderedGroupQuantity(state, entry, group = groupFor(entry)) {
  if (isDistinct(entry)) {
    return group.slots.reduce((total, member) => total + orderedSlotQuantity(state, entry, member.slotIndex), 0);
  }
  return positiveQuantity(state.ordered[groupKeyFor(entry.checklist.id, entry.item, group.key)]);
}

function mutateSlot(state, entry, slotIndex, delta) {
  const checklistId = entry.checklist.id;
  const checkKey = keyFor(checklistId, entry.item, slotIndex);
  const extraKey = slotExtraKeyFor(checklistId, entry.item, slotIndex);
  const current = slotQuantity(state, entry, slotIndex);
  if (delta > 0) {
    if (!current) state.checks[checkKey] = true;
    else state.extras[extraKey] = positiveQuantity(state.extras[extraKey]) + 1;
  } else if (delta < 0 && current) {
    const extras = positiveQuantity(state.extras[extraKey]);
    if (extras <= 1) delete state.extras[extraKey];
    else state.extras[extraKey] = extras - 1;
    if (!extras) delete state.checks[checkKey];
  }
}

function mutateGroup(state, entry, delta) {
  const group = groupFor(entry);
  if (isDistinct(entry)) {
    if (delta > 0) {
      const next = group.slots.reduce((best, member) =>
        slotQuantity(state, entry, member.slotIndex) < slotQuantity(state, entry, best.slotIndex) ? member : best,
      group.slots[0]);
      mutateSlot(state, entry, next.slotIndex, 1);
    } else if (delta < 0) {
      const owned = group.slots.filter((member) => slotQuantity(state, entry, member.slotIndex) > 0);
      const next = owned.reduce((best, member) => !best ||
        slotQuantity(state, entry, member.slotIndex) >= slotQuantity(state, entry, best.slotIndex) ? member : best, null);
      if (next) mutateSlot(state, entry, next.slotIndex, -1);
    }
    return;
  }
  const extraKey = groupKeyFor(entry.checklist.id, entry.item, group.key);
  const extras = positiveQuantity(state.extras[extraKey]);
  if (delta > 0) {
    const next = group.slots.find((member) => !state.checks[keyFor(entry.checklist.id, entry.item, member.slotIndex)]);
    if (next) state.checks[keyFor(entry.checklist.id, entry.item, next.slotIndex)] = true;
    else state.extras[extraKey] = extras + 1;
  } else if (delta < 0) {
    if (extras === 1) delete state.extras[extraKey];
    else if (extras > 1) state.extras[extraKey] = extras - 1;
    else {
      const checked = group.slots.filter((member) => state.checks[keyFor(entry.checklist.id, entry.item, member.slotIndex)]);
      const last = checked[checked.length - 1];
      if (last) delete state.checks[keyFor(entry.checklist.id, entry.item, last.slotIndex)];
    }
  }
}

function mutateOrderedGroup(state, entry, delta) {
  const group = groupFor(entry);
  if (isDistinct(entry)) {
    if (delta > 0) {
      const next = group.slots.reduce((best, member) => {
        const memberTotal = slotQuantity(state, entry, member.slotIndex) + orderedSlotQuantity(state, entry, member.slotIndex);
        const bestTotal = slotQuantity(state, entry, best.slotIndex) + orderedSlotQuantity(state, entry, best.slotIndex);
        return memberTotal < bestTotal ? member : best;
      }, group.slots[0]);
      const key = slotExtraKeyFor(entry.checklist.id, entry.item, next.slotIndex);
      state.ordered[key] = positiveQuantity(state.ordered[key]) + 1;
    } else if (delta < 0) {
      const incoming = group.slots.filter((member) => orderedSlotQuantity(state, entry, member.slotIndex) > 0);
      const next = incoming.reduce((best, member) => !best ||
        orderedSlotQuantity(state, entry, member.slotIndex) >= orderedSlotQuantity(state, entry, best.slotIndex) ? member : best, null);
      if (next) {
        const key = slotExtraKeyFor(entry.checklist.id, entry.item, next.slotIndex);
        const count = positiveQuantity(state.ordered[key]);
        if (count <= 1) delete state.ordered[key]; else state.ordered[key] = count - 1;
      }
    }
    return;
  }
  const key = groupKeyFor(entry.checklist.id, entry.item, group.key);
  const next = Math.max(0, positiveQuantity(state.ordered[key]) + delta);
  if (next) state.ordered[key] = next; else delete state.ordered[key];
}

function describe(stateInput, entry) {
  const state = emptyState(stateInput);
  const group = groupFor(entry);
  const target = group.slots.filter((member) => member.slot.r !== false).length;
  return {
    productId: entry.ref.productId,
    game: entry.ref.game,
    checklistId: entry.checklist.id,
    checklistTitle: entry.checklist.title,
    item: entry.item.name,
    code: entry.item.code || null,
    product: entry.ref.productName,
    slotGroup: group.name,
    target,
    owned: groupQuantity(state, entry, group),
    ordered: orderedGroupQuantity(state, entry, group),
    remaining: Math.max(0, target - groupQuantity(state, entry, group) - orderedGroupQuantity(state, entry, group)),
    progressMode: entry.checklist.progressMode || 'quantity',
  };
}

function setQuantities(stateInput, entry, { owned, ordered } = {}) {
  const state = emptyState(stateInput);
  if (owned !== undefined) {
    assertQuantity(owned, 'owned');
    while (groupQuantity(state, entry) < owned) mutateGroup(state, entry, 1);
    while (groupQuantity(state, entry) > owned) mutateGroup(state, entry, -1);
  }
  if (ordered !== undefined) {
    assertQuantity(ordered, 'ordered');
    while (orderedGroupQuantity(state, entry) < ordered) mutateOrderedGroup(state, entry, 1);
    while (orderedGroupQuantity(state, entry) > ordered) mutateOrderedGroup(state, entry, -1);
  }
  return state;
}

function receive(stateInput, entry, count = 1) {
  assertQuantity(count, 'count');
  const state = emptyState(stateInput);
  const move = Math.min(count, orderedGroupQuantity(state, entry));
  for (let i = 0; i < move; i += 1) {
    const group = groupFor(entry);
    if (isDistinct(entry)) {
      const incoming = group.slots.filter((member) => orderedSlotQuantity(state, entry, member.slotIndex) > 0);
      const next = incoming.reduce((best, member) => !best ||
        orderedSlotQuantity(state, entry, member.slotIndex) >= orderedSlotQuantity(state, entry, best.slotIndex) ? member : best, null);
      if (!next) break;
      const key = slotExtraKeyFor(entry.checklist.id, entry.item, next.slotIndex);
      const quantity = positiveQuantity(state.ordered[key]);
      if (quantity <= 1) delete state.ordered[key]; else state.ordered[key] = quantity - 1;
      mutateSlot(state, entry, next.slotIndex, 1);
    } else {
      mutateOrderedGroup(state, entry, -1);
      mutateGroup(state, entry, 1);
    }
  }
  return state;
}

function findProducts(index, query, checklistId) {
  const needle = norm(query);
  if (!needle) throw new Error('A productId, set code, or exact product name is required');
  return index.products.filter((entry) => {
    if (checklistId && entry.checklist.id !== checklistId) return false;
    const haystack = [entry.ref.productId, entry.ref.productName, entry.item.name, entry.item.code, entry.ref.setCode]
      .map(norm);
    return haystack.some((value) => value === needle || value.includes(needle));
  });
}

function resolveProduct(index, query, checklistId) {
  const exact = index.byId.get(query);
  if (exact && (!checklistId || exact.checklist.id === checklistId)) return exact;
  const matches = findProducts(index, query, checklistId);
  if (!matches.length) throw new Error('No catalog ProductRef matched "' + query + '"');
  if (matches.length > 1) {
    const options = matches.slice(0, 8).map((entry) => entry.checklist.id + ': ' + entry.ref.productId).join('; ');
    throw new Error('Ambiguous product query "' + query + '". Use --lane and/or the full productId. Matches: ' + options);
  }
  return matches[0];
}

module.exports = {
  norm, contentHash, keyFor, groupKeyFor, slotExtraKeyFor, groupSlots,
  emptyState, createCatalog, findProducts, resolveProduct, describe,
  setQuantities, receive,
};
