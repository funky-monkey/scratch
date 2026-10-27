// Self-check for the folder-date sort orders: `npx tsx scripts/check-sorting.ts`
import { SORT_STRATEGIES } from "../src/lib/sorting";
import type { FolderNode, NoteMetadata } from "../src/types/note";

const note = (modified: number) =>
  ({ id: String(modified), title: "", preview: "", modified, tags: [] }) as unknown as NoteMetadata;
const folder = (name: string, notes: NoteMetadata[], children: FolderNode[] = []): FolderNode => ({
  name, path: name, notes, children, attachments: [],
});

const old = folder("B", [note(1)]);
const fresh = folder("A", [note(2)], [folder("A/c", [note(9)])]); // newest note sits in a subfolder

const asc = [fresh, old].sort(SORT_STRATEGIES["folder-date-asc"].compareFolders!);
const desc = [old, fresh].sort(SORT_STRATEGIES["folder-date-desc"].compareFolders!);
if (asc[0] !== old || desc[0] !== fresh) throw new Error("folder date sorting is wrong");
console.log("sorting self-check ok");
