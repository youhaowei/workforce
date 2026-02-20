/**
 * AppContextMenu — Global right-click context menu with clipboard actions.
 *
 * Wraps the entire app to replace the browser's default context menu
 * with Cut / Copy / Paste / Select All using Radix UI ContextMenu.
 *
 * Key implementation detail: Radix closes the menu *before* firing onSelect,
 * so we snapshot the active element and text selection when the menu opens
 * (onOpenChange) and operate on the captured state in handlers.
 */

import { useEffect, useCallback, useRef } from 'react';
import { Scissors, Copy, ClipboardPaste, TextSelect } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { usePlatform } from '@/ui/context/PlatformProvider';

const isMac =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.platform);
const modKey = isMac ? '⌘' : 'Ctrl+';

/** Returns true when right-click target is an editable element or has text selected. */
function isTextContext(target: EventTarget | null): boolean {
  const selection = window.getSelection()?.toString();
  if (selection) return true;

  if (target instanceof HTMLInputElement) {
    // Exclude non-text input types (checkbox, radio, range, file, color, etc.)
    const nonTextTypes = new Set(['checkbox', 'radio', 'range', 'file', 'color', 'button', 'submit', 'reset', 'image', 'hidden']);
    return !nonTextTypes.has(target.type);
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.contentEditable === 'true') return true;

  return false;
}

interface Snapshot {
  element: Element | null;
  text: string;
}

interface AppContextMenuProps {
  children: React.ReactNode;
}

export function AppContextMenu({ children }: AppContextMenuProps) {
  const { isTauri } = usePlatform();
  const saved = useRef<Snapshot>({ element: null, text: '' });

  // Gate the context menu: only allow the Radix menu to open on text/editable
  // targets. For non-text contexts we stop propagation so Radix never sees it
  // (Radix ContextMenu doesn't support a controlled `open` prop).
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!isTextContext(e.target)) {
        // Block Radix from opening; let native menu through on web, suppress on Tauri
        if (isTauri) e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (isTauri) e.preventDefault();
    };
    // Use capture phase so we intercept before Radix's trigger listener
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => document.removeEventListener('contextmenu', onContextMenu, true);
  }, [isTauri]);

  // Snapshot active element + selection when the menu opens
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      saved.current = {
        element: document.activeElement,
        text: window.getSelection()?.toString() ?? '',
      };
    }
  }, []);

  const restoreFocus = useCallback(() => {
    const el = saved.current.element;
    if (el instanceof HTMLElement) el.focus();
  }, []);

  const handleCut = useCallback(async () => {
    const { text } = saved.current;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    restoreFocus();
    // Delete the selection from the original element
    document.execCommand('delete');
  }, [restoreFocus]);

  const handleCopy = useCallback(async () => {
    const { text } = saved.current;
    if (text) await navigator.clipboard.writeText(text);
  }, []);

  const handlePaste = useCallback(async () => {
    restoreFocus();
    try {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
    } catch {
      // Clipboard read may require permission
    }
  }, [restoreFocus]);

  const handleSelectAll = useCallback(() => {
    restoreFocus();
    const el = saved.current.element;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.select();
    } else {
      document.execCommand('selectAll');
    }
  }, [restoreFocus]);

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <div className="contents">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={handleCut}>
          <Scissors className="mr-2 h-4 w-4" />
          Cut
          <ContextMenuShortcut>{modKey}X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleCopy}>
          <Copy className="mr-2 h-4 w-4" />
          Copy
          <ContextMenuShortcut>{modKey}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={handlePaste}>
          <ClipboardPaste className="mr-2 h-4 w-4" />
          Paste
          <ContextMenuShortcut>{modKey}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleSelectAll}>
          <TextSelect className="mr-2 h-4 w-4" />
          Select All
          <ContextMenuShortcut>{modKey}A</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
