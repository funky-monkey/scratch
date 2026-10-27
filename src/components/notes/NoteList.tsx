import { useCallback, useMemo, memo, useEffect, useRef, useState } from "react";
import { useFlipAnimation } from "../../hooks/useFlipAnimation";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { invoke } from "@tauri-apps/api/core";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useNotes } from "../../context/NotesContext";
import {
  ListItem,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui";
import { cleanTitle, formatNoteDate } from "../../lib/utils";
import * as notesService from "../../services/notes";
import { FolderTreeView } from "./FolderTreeView";
import {
  PinIcon,
  CopyIcon,
  TrashIcon,
  ExternalLinkIcon,
} from "../icons";
import type { AttachmentMetadata, NoteMetadata } from "../../types/note";
import { getSortStrategy, withManualOrder } from "../../lib/sorting";
import { FileTypeIcon } from "./FileTypeIcon";

const menuItemClass =
  "px-3 py-1.5 text-sm text-text cursor-pointer outline-none hover:bg-bg-muted focus:bg-bg-muted flex items-center gap-2 rounded-sm";

const menuSeparatorClass = "h-px bg-border my-1";


// Memoized note item component (used in flat list)
interface NoteItemProps {
  id: string;
  title: string;
  preview?: string;
  modified: number;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: (id: string) => void;
  depth?: number;
  showFolderPrefix?: boolean;
}

export const NoteItem = memo(function NoteItem({
  id,
  title,
  preview,
  modified,
  isSelected,
  isPinned,
  onSelect,
  depth,
  showFolderPrefix = true,
}: NoteItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handleClick = useCallback(() => onSelect(id), [onSelect, id]);

  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  const folder =
    showFolderPrefix && id.includes("/")
      ? id.substring(0, id.lastIndexOf("/"))
      : null;
  const displayPreview = folder
    ? preview
      ? `${folder}/ · ${preview}`
      : `${folder}/`
    : preview;

  return (
    <div
      ref={ref}
      style={depth != null ? { paddingLeft: `${depth * 12}px` } : undefined}
      className="relative group/noteitem"
    >
      {/* Sleek edge grab pill bar, visible on hover */}
      <div className="absolute left-[3px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-accent/40 opacity-0 group-hover/noteitem:opacity-100 transition-opacity duration-150 pointer-events-none z-10" />
      
      <ListItem
        title={cleanTitle(title)}
        subtitle={displayPreview}
        meta={formatNoteDate(modified)}
        isSelected={isSelected}
        isPinned={isPinned}
        onClick={handleClick}
      />
    </div>
  );
});

// Note item wrapped with Radix context menu
interface NoteItemWithMenuProps {
  id: string;
  title: string;
  preview?: string;
  modified: number;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: (id: string) => void;
  onPin: (id: string) => Promise<void>;
  onUnpin: (id: string) => Promise<void>;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRefreshSettings: () => Promise<void> | void;
}

const NoteItemWithMenu = memo(function NoteItemWithMenu({
  id,
  title,
  preview,
  modified,
  isSelected,
  isPinned,
  onSelect,
  onPin,
  onUnpin,
  onDuplicate,
  onDelete,
  onRefreshSettings,
}: NoteItemWithMenuProps) {
  const handlePin = useCallback(async () => {
    try {
      await (isPinned ? onUnpin(id) : onPin(id));
      await onRefreshSettings();
    } catch (error) {
      console.error("Failed to pin/unpin note:", error);
    }
  }, [id, isPinned, onPin, onUnpin, onRefreshSettings]);

  const handleCopyFilepath = useCallback(async () => {
    try {
      const folder = await notesService.getNotesFolder();
      if (folder) {
        const filepath = `${folder}/${id}.md`;
        await invoke("copy_to_clipboard", { text: filepath });
      }
    } catch (error) {
      console.error("Failed to copy filepath:", error);
    }
  }, [id]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div>
          <NoteItem
            id={id}
            title={title}
            preview={preview}
            modified={modified}
            isSelected={isSelected}
            isPinned={isPinned}
            onSelect={onSelect}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-44 bg-bg border border-border rounded-md shadow-lg py-1 z-50">
          <ContextMenu.Item className={menuItemClass} onSelect={handlePin}>
            <PinIcon className="w-4 h-4 stroke-[1.6]" />
            {isPinned ? "Unpin" : "Pin"}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItemClass}
            onSelect={() => onDuplicate(id)}
          >
            <CopyIcon className="w-4 h-4 stroke-[1.6]" />
            Duplicate
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menuItemClass}
            onSelect={handleCopyFilepath}
          >
            <CopyIcon className="w-4 h-4 stroke-[1.6]" />
            Copy Filepath
          </ContextMenu.Item>
          <ContextMenu.Separator className={menuSeparatorClass} />
          <ContextMenu.Item
            className={
              menuItemClass +
              " text-red-500 hover:text-red-500 focus:text-red-500"
            }
            onSelect={() => onDelete(id)}
          >
            <TrashIcon className="w-4 h-4 stroke-[1.6]" />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

interface AttachmentItemProps {
  attachment: AttachmentMetadata;
  isSelected: boolean;
  onSelect: (attachment: AttachmentMetadata) => void;
  showFolderPrefix?: boolean;
}

const AttachmentItem = memo(function AttachmentItem({
  attachment,
  isSelected,
  onSelect,
  showFolderPrefix = true,
}: AttachmentItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const folder =
    showFolderPrefix && attachment.id.includes("/")
      ? attachment.id.substring(0, attachment.id.lastIndexOf("/"))
      : null;
  const subtitle = folder
    ? `${folder}/ · ${attachment.extension.toUpperCase()}`
    : attachment.extension.toUpperCase();

  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  const handleCopyFilepath = useCallback(async () => {
    try {
      await invoke("copy_to_clipboard", { text: attachment.path });
    } catch (error) {
      console.error("Failed to copy filepath:", error);
    }
  }, [attachment.path]);

  const handleReveal = useCallback(async () => {
    try {
      await invoke("open_in_file_manager", { path: attachment.path });
    } catch (error) {
      console.error("Failed to reveal file:", error);
    }
  }, [attachment.path]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div ref={ref}>
          <ListItem
            title={attachment.name}
            subtitle={subtitle}
            meta={formatNoteDate(attachment.modified)}
            icon={<FileTypeIcon kind={attachment.kind} />}
            isSelected={isSelected}
            onClick={() => onSelect(attachment)}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-44 bg-bg border border-border rounded-md shadow-lg py-1 z-50">
          <ContextMenu.Item className={menuItemClass} onSelect={handleCopyFilepath}>
            <CopyIcon className="w-4 h-4 stroke-[1.6]" />
            Copy Filepath
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItemClass} onSelect={handleReveal}>
            <ExternalLinkIcon className="w-4 h-4 stroke-[1.6]" />
            Reveal in File Manager
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

interface SortableNoteItemProps extends NoteItemWithMenuProps {
  dragOverInfo?: { id: string; position: "before" | "after" } | null;
}

const SortableNoteItem = memo(function SortableNoteItem(props: SortableNoteItemProps) {
  const { id, dragOverInfo } = props;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `note:${id}`,
    data: { type: "note", id: id },
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: `drop-note:${id}`,
    data: { type: "note", id: id, path: "" },
  });

  const isTargetBefore = dragOverInfo?.id === id && dragOverInfo.position === "before";
  const isTargetAfter = dragOverInfo?.id === id && dragOverInfo.position === "after";

  return (
    <div 
      data-id={id}
      className="relative py-0.5"
    >
      {/* Sleek drop indicator line */}
      <div 
        className="absolute left-1.5 right-1.5 h-[2px] bg-accent z-20 pointer-events-none transition-all duration-200 ease-out origin-left"
        style={{
          top: isTargetBefore ? "-1px" : isTargetAfter ? "auto" : "0px",
          bottom: isTargetAfter ? "-1px" : "auto",
          opacity: (isTargetBefore || isTargetAfter) ? 1 : 0,
          transform: (isTargetBefore || isTargetAfter) ? "scaleX(1)" : "scaleX(0)",
        }}
      >
        {/* Rounded dot on the left edge */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1.5 h-1.5 rounded-full bg-accent" />
      </div>

      <div
        ref={(el) => {
          setDragRef(el);
          setDropRef(el);
        }}
        {...attributes}
        {...listeners}
        className={`transition-[opacity,background-color,scale] duration-200 ${
          isDragging 
            ? "opacity-30 scale-[0.97] pointer-events-none" 
            : ""
        }`}
      >
        <NoteItemWithMenu {...props} />
      </div>
    </div>
  );
});

interface NoteListProps {
  multiSelectedNoteIds: Set<string>;
  setMultiSelectedNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  lastClickedNoteId: string | null;
  setLastClickedNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  dragOverInfo?: { id: string; position: "before" | "after" } | null;
}

export function NoteList({
  multiSelectedNoteIds,
  setMultiSelectedNoteIds,
  lastClickedNoteId,
  setLastClickedNoteId,
  dragOverInfo,
}: NoteListProps) {
  const {
    notes,
    attachments,
    selectedNoteId,
    selectedAttachment,
    selectNote,
    selectAttachment,
    deleteNote,
    duplicateNote,
    pinNote,
    unpinNote,
    isLoading,
    searchQuery,
    searchResults,
    settings,
    refreshSettings,
  } = useNotes();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  // containerRef is declared below displayItems to avoid TDZ errors

  const pinnedIds = useMemo(
    () => new Set(settings?.pinnedNoteIds || []),
    [settings]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (noteToDelete) {
      try {
        await deleteNote(noteToDelete);
        setNoteToDelete(null);
        setDeleteDialogOpen(false);
      } catch (error) {
        console.error("Failed to delete note:", error);
      }
    }
  }, [noteToDelete, deleteNote]);

  const openDeleteDialogForNote = useCallback((noteId: string) => {
    setNoteToDelete(noteId);
    setDeleteDialogOpen(true);
  }, []);

  // Memoize display items to prevent recalculation on every render
  const displayItems = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults.map((r) => ({
        id: r.id,
        title: r.title,
        preview: r.preview,
        modified: r.modified,
      }));
    }
    const strategy = getSortStrategy(settings?.sortOrder);
    const compareNotes =
      strategy.id === "manual"
        ? withManualOrder<NoteMetadata>(settings?.noteOrder, (n) => n.id, strategy.compareNotes)
        : strategy.compareNotes;
    const sorted = [...notes];
    sorted.sort((a, b) => {
      const ap = pinnedIds.has(a.id);
      const bp = pinnedIds.has(b.id);
      if (ap !== bp) return ap ? -1 : 1;
      return compareNotes(a, b);
    });
    return sorted;
  }, [searchQuery, searchResults, notes, settings?.sortOrder, settings?.noteOrder, pinnedIds]);

  const displayAttachments = useMemo(() => {
    if (!searchQuery.trim()) return attachments;
    const query = searchQuery.trim().toLowerCase();
    return attachments.filter((attachment) =>
      attachment.name.toLowerCase().includes(query) ||
      attachment.id.toLowerCase().includes(query),
    );
  }, [attachments, searchQuery]);

  const containerRef = useFlipAnimation(displayItems);

  // Listen for focus request from editor (when Escape is pressed)
  useEffect(() => {
    const handleFocusNoteList = () => {
      containerRef.current?.focus();
    };

    window.addEventListener("focus-note-list", handleFocusNoteList);
    return () =>
      window.removeEventListener("focus-note-list", handleFocusNoteList);
  }, []);

  useEffect(() => {
    const handleRequestDelete = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      if (!customEvent.detail) return;
      openDeleteDialogForNote(customEvent.detail);
    };

    window.addEventListener("request-delete-note", handleRequestDelete);
    return () =>
      window.removeEventListener("request-delete-note", handleRequestDelete);
  }, [openDeleteDialogForNote]);

  const foldersEnabled = settings?.foldersEnabled === true;
  const isSearching = searchQuery.trim().length > 0;

  if (isLoading && notes.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted select-none">
        Loading...
      </div>
    );
  }

  if (isSearching && displayItems.length === 0 && displayAttachments.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No results found
      </div>
    );
  }

  if (displayItems.length === 0 && displayAttachments.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No notes yet
      </div>
    );
  }

  // Show folder tree view when folders enabled and not searching
  if (foldersEnabled && !isSearching) {
    return (
      <>
        <FolderTreeView
          pinnedIds={pinnedIds}
          settings={settings}
          multiSelectedNoteIds={multiSelectedNoteIds}
          setMultiSelectedNoteIds={setMultiSelectedNoteIds}
          lastClickedNoteId={lastClickedNoteId}
          setLastClickedNoteId={setLastClickedNoteId}
          dragOverInfo={dragOverInfo}
        />

        {/* Delete confirmation dialog */}
        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete note?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the note and all its content. This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteConfirm}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        data-note-list
        className="group/notelist flex flex-col gap-1 p-1.5 outline-none"
      >
        {displayItems.map((item) => (
          <SortableNoteItem
            key={item.id}
            id={item.id}
            title={item.title}
            preview={item.preview}
            modified={item.modified}
            isSelected={selectedNoteId === item.id}
            isPinned={pinnedIds.has(item.id)}
            onSelect={selectNote}
            onPin={pinNote}
            onUnpin={unpinNote}
            onDuplicate={duplicateNote}
            onDelete={openDeleteDialogForNote}
            onRefreshSettings={refreshSettings}
            dragOverInfo={dragOverInfo}
          />
        ))}
        {displayAttachments.map((attachment) => (
          <AttachmentItem
            key={attachment.id}
            attachment={attachment}
            isSelected={selectedAttachment?.id === attachment.id}
            onSelect={selectAttachment}
          />
        ))}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the note and all its content. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
