/**
 * Icons — re-exported from lucide-react at a standardised 18×18.
 * All icons use `currentColor` so existing colour styling continues to work.
 * Legacy component names are kept so call-sites need no changes.
 */
import {
  Calendar,
  X,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Plus as PlusIcon,
  Hash,
  BarChart3,
  Dumbbell as DumbbellIcon,
  NotebookPen,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { LucideProps } from 'lucide-react';

// #226: single source of truth for the shared icon size — bump this one
// line rather than repeating a literal on every wrapper below.
const ICON_SIZE = 18;

type ClassNameProps = { className?: string };
type DeleteProps = { className?: string; style?: CSSProperties };
// Plus/Dumbbell forward any remaining lucide prop (aria-hidden, onClick, ...)
// through to the underlying icon, same as every other prop these wrap.
type ForwardedIconProps = Omit<LucideProps, 'className' | 'size'> & { className?: string };

export function Calender({ className }: ClassNameProps) {
  return <Calendar className={className} size={ICON_SIZE} />;
}

export function Delete({ className, style }: DeleteProps) {
  return <X className={className} style={style} size={ICON_SIZE} />;
}

export function DropdownClosed({ className }: ClassNameProps) {
  return <ChevronRight className={className} size={ICON_SIZE} />;
}

export function DropdownOpen({ className }: ClassNameProps) {
  return <ChevronDown className={className} size={ICON_SIZE} />;
}

export function Profile({ className }: ClassNameProps) {
  return <CircleUserRound className={className} size={ICON_SIZE} />;
}

export function Plus({ className, ...props }: ForwardedIconProps) {
  return <PlusIcon className={className} {...props} size={ICON_SIZE} />;
}

export function Number({ className }: ClassNameProps) {
  return <Hash className={className} size={ICON_SIZE} />;
}

export function Chart({ className }: ClassNameProps) {
  return <BarChart3 className={className} size={ICON_SIZE} />;
}

export function Dumbbell({ className, ...props }: ForwardedIconProps) {
  return <DumbbellIcon className={className} {...props} size={ICON_SIZE} />;
}

export function Notes({ className }: ClassNameProps) {
  return <NotebookPen className={className} size={ICON_SIZE} />;
}
