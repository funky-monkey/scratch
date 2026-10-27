import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Clean title - remove markdown syntax and invisible characters
 */
export function cleanTitle(title: string | undefined): string {
  if (!title) return "Untitled";
  const cleaned = title
    // Remove heading markers (##, ###, etc.)
    .replace(/^#+\s+/, "")
    // Remove bold (**text** or __text__)
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    // Remove italic (*text* or _text_)
    .replace(/(\*|_)(.*?)\1/g, "$2")
    // Remove strikethrough (~~text~~)
    .replace(/~~(.*?)~~/g, "$1")
    // Remove inline code (`code`)
    .replace(/`([^`]+)`/g, "$1")
    // Remove images ![alt](url) - must come before links to avoid leaving "!"
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Remove links [text](url) - keep only text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove non-breaking spaces and other invisible characters
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .trim();
  return cleaned || "Untitled";
}

/** Short "last modified" label: time today, "Yesterday", "3 days ago", then a date. */
export function formatNoteDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);

  if (date >= startOfToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (date >= startOfYesterday) {
    return "Yesterday";
  }

  const daysAgo =
    Math.floor((startOfToday.getTime() - date.getTime()) / 86400000) + 1;
  if (daysAgo <= 6) {
    return `${daysAgo} days ago`;
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Full date and time, e.g. "Tue, Oct 27, 2026, 2:05 PM". */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
