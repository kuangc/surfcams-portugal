export function createMonitorSelection(max = 6) {
  const ids = [];

  function selectedIds() {
    return [...ids];
  }

  function has(id) {
    return ids.includes(id);
  }

  function count() {
    return ids.length;
  }

  function isFull() {
    return count() >= max;
  }

  function add(id) {
    if (has(id)) {
      return { added: false, removed: false, rejected: false };
    }

    if (isFull()) {
      return { added: false, removed: false, rejected: true, reason: "limit" };
    }

    ids.push(id);
    return { added: true, removed: false, rejected: false };
  }

  function remove(id) {
    const index = ids.indexOf(id);
    if (index === -1) return { added: false, removed: false, rejected: false };

    ids.splice(index, 1);
    return { added: false, removed: true, rejected: false };
  }

  function toggle(id) {
    return has(id) ? remove(id) : add(id);
  }

  function clear() {
    ids.splice(0, ids.length);
  }

  return {
    add,
    clear,
    count,
    has,
    isFull,
    max,
    remove,
    selectedIds,
    toggle
  };
}
