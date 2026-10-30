export function cartProductQuantity(cart, productId, ignoredIndex = null) {
  return (cart || []).reduce((total, line, index) => {
    if (index === ignoredIndex || line?.unregistered || line?.dairy) return total;
    return line?.id === productId ? total + Number(line.qty || 0) : total;
  }, 0);
}

export function validateInventoryQuantity(product, cart, requested, editingIndex = null) {
  const quantity = Number(requested);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    return { ok: false, reason: "invalid", available: Number(product?.available || 0) };
  }
  if (product?.dairy || product?.available === Infinity) {
    return { ok: true, requested: quantity, total: quantity, available: Infinity };
  }
  const available = Number(product?.available ?? 0);
  const alreadyInCart = cartProductQuantity(cart, product?.id, editingIndex);
  const total = alreadyInCart + quantity;
  if (!Number.isFinite(available) || available <= 0) {
    return { ok: false, reason: "empty", requested: quantity, total, available };
  }
  if (total > available) {
    return { ok: false, reason: "insufficient", requested: quantity, total, available };
  }
  return { ok: true, requested: quantity, total, available };
}
