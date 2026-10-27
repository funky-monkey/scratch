import type { NoteMetadata, FolderNode, SortOrder } from "../types/note";

export interface SortStrategy {
  id: SortOrder;
  label: string;
  description: string;
  compareNotes: (a: NoteMetadata, b: NoteMetadata) => number;
  compareFolders?: (a: FolderNode, b: FolderNode) => number;
}

// Natural collation for human-friendly sorting (e.g. "1 - Note", "2 - Note", "10 - Note")
const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const naturalCompare = (a: string, b: string) =>
  naturalCollator.compare(a, b) || a.localeCompare(b);

// A folder's date is its most recently modified note, subfolders included.
const folderDates = new WeakMap<FolderNode, number>();
function folderModified(folder: FolderNode): number {
  const cached = folderDates.get(folder);
  if (cached !== undefined) return cached;
  const latest = Math.max(
    0,
    ...folder.notes.map((n) => n.modified),
    ...folder.children.map(folderModified),
  );
  folderDates.set(folder, latest);
  return latest;
}

export const SORT_STRATEGIES: Record<SortOrder, SortStrategy> = {
  "title-asc": {
    id: "title-asc",
    label: "Alphabetical / Folder Structure (A–Z)",
    description: "Sorted by note title and natural number order",
    compareNotes: (a, b) => naturalCompare(a.title || a.id, b.title || b.id),
    compareFolders: (a, b) => naturalCompare(a.name, b.name),
  },
  "modified-desc": {
    id: "modified-desc",
    label: "Last Modified (Newest First)",
    description: "Recently edited notes appear at the top",
    compareNotes: (a, b) => b.modified - a.modified,
    compareFolders: (a, b) => naturalCompare(a.name, b.name),
  },
  "modified-asc": {
    id: "modified-asc",
    label: "Last Modified (Oldest First)",
    description: "Oldest edited notes appear at the top",
    compareNotes: (a, b) => a.modified - b.modified,
    compareFolders: (a, b) => naturalCompare(a.name, b.name),
  },
  "folder-date-asc": {
    id: "folder-date-asc",
    label: "Folder based, on date A–Z",
    description: "Folders and notes from oldest to most recently changed",
    compareNotes: (a, b) => a.modified - b.modified,
    compareFolders: (a, b) =>
      folderModified(a) - folderModified(b) || naturalCompare(a.name, b.name),
  },
  "folder-date-desc": {
    id: "folder-date-desc",
    label: "Folder based, on date Z–A",
    description: "Most recently changed folders and notes first",
    compareNotes: (a, b) => b.modified - a.modified,
    compareFolders: (a, b) =>
      folderModified(b) - folderModified(a) || naturalCompare(a.name, b.name),
  },
  manual: {
    id: "manual",
    label: "Manual (Drag and Drop)",
    description: "Drag notes and folders into your own order",
    compareNotes: (a, b) => b.modified - a.modified,
    compareFolders: (a, b) => naturalCompare(a.name, b.name),
  },
  "title-desc": {
    id: "title-desc",
    label: "Alphabetical (Z–A)",
    description: "Reverse alphabetical order",
    compareNotes: (a, b) => naturalCompare(b.title || b.id, a.title || a.id),
    compareFolders: (a, b) => naturalCompare(b.name, a.name),
  },
};

export const DEFAULT_SORT_ORDER: SortOrder = "modified-desc";

export function getSortStrategy(sortOrder?: string | null): SortStrategy {
  if (sortOrder && Object.prototype.hasOwnProperty.call(SORT_STRATEGIES, sortOrder)) {
    return SORT_STRATEGIES[sortOrder as SortOrder];
  }
  return SORT_STRATEGIES[DEFAULT_SORT_ORDER];
}

// Items in the manual order come first in that order; the rest fall back.
export function withManualOrder<T>(
  order: string[] | undefined,
  key: (item: T) => string,
  fallback: (a: T, b: T) => number,
): (a: T, b: T) => number {
  if (!order || order.length === 0) return fallback;
  const index = new Map(order.map((id, i) => [id, i]));
  return (a, b) => {
    const ai = index.get(key(a));
    const bi = index.get(key(b));
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return fallback(a, b);
  };
}

