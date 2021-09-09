import { JournalQuery } from './JournalQuery';
import { JournalEntry } from './JournalEntry';

export function journalFilterByQuery(
  query?: JournalQuery,
): (entry: JournalEntry) => boolean {
  return (entry: JournalEntry): boolean => {
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
