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

// #226: single source of truth for the shared icon size — bump this one
// line rather than repeating a literal on every wrapper below.
const ICON_SIZE = 18;

export function Calender({ className }) {
  return <Calendar className={className} size={ICON_SIZE} />;
}

export function Delete({ className, style }) {
  return <X className={className} style={style} size={ICON_SIZE} />;
}

export function DropdownClosed({ className }) {
  return <ChevronRight className={className} size={ICON_SIZE} />;
}

export function DropdownOpen({ className }) {
  return <ChevronDown className={className} size={ICON_SIZE} />;
}

export function Profile({ className }) {
  return <CircleUserRound className={className} size={ICON_SIZE} />;
}

export function Plus({ className, ...props }) {
  return <PlusIcon className={className} {...props} size={ICON_SIZE} />;
}

export function Number({ className }) {
  return <Hash className={className} size={ICON_SIZE} />;
}

export function Chart({ className }) {
  return <BarChart3 className={className} size={ICON_SIZE} />;
}

export function Dumbbell({ className, ...props }) {
  return <DumbbellIcon className={className} {...props} size={ICON_SIZE} />;
}

export function Notes({ className }) {
  return <NotebookPen className={className} size={ICON_SIZE} />;
}
