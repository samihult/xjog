import { FullStateQuery } from './FullStateQuery';
import { FullStateEntry } from './FullStateEntry';

export function fullStateFilterByQuery(
  query?: FullStateQuery,
): (entry: FullStateEntry) => boolean {
  return (entry: FullStateEntry): boolean => {
    if (!query) {
      return true;
    }

    if (Array.isArray(query)) {
      return !!query.find(
        (candidate) =>
          entry.ref.machineId === candidate.machineId &&
          entry.ref.chartId === candidate.chartId,
      );
    }

    if (query.ref) {
      if (
        entry.ref.machineId !== query.ref.machineId ||
        entry.ref.chartId !== query.ref.chartId
      ) {
        return false;
      }
    } else {
      if (query.machineId && query.machineId !== entry.ref.machineId) {
        return false;
      }
    }

    if (query.parentRef) {
      if (
        entry.parentRef?.machineId !== query.parentRef.machineId ||
        entry.parentRef?.chartId !== query.parentRef.chartId
      ) {
        return false;
      }
    }

    if (query.afterId) {
      if (entry.id <= query.afterId) {
        return false;
      }
    }

    if (query.afterAndIncludingId) {
      if (entry.id < query.afterAndIncludingId) {
        return false;
      }
    }

    if (query.beforeId) {
      if (entry.id >= query.beforeId) {
        return false;
      }
    }

    if (query.beforeAndIncludingId) {
      if (entry.id > query.beforeAndIncludingId) {
        return false;
      }
    }

    if (query.createdAfterAndIncluding) {
      if (entry.created < query.createdAfterAndIncluding) {
        return false;
      }
    }

    if (query.createdBeforeAndIncluding) {
      if (entry.created > query.createdBeforeAndIncluding) {
        return false;
      }
    }

    if (query.updatedAfterAndIncluding) {
      if (entry.timestamp < query.updatedAfterAndIncluding) {
        return false;
      }
    }

    if (query.updatedBeforeAndIncluding) {
      if (entry.timestamp > query.updatedBeforeAndIncluding) {
        return false;
      }
    }

    return true;
  };
}
