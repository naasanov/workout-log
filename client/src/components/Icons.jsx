/**
 * Icons — re-exported from lucide-react at a standardised 16×16.
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
} from 'lucide-react';

export function Calender({ className }) {
  return <Calendar className={className} size={16} />;
}

export function Delete({ className, style }) {
  return <X className={className} style={style} size={16} />;
}

export function DropdownClosed({ className }) {
  return <ChevronRight className={className} size={16} />;
}

export function DropdownOpen({ className }) {
  return <ChevronDown className={className} size={16} />;
}

export function Profile({ className }) {
  return <CircleUserRound className={className} size={16} />;
}

export function Plus({ className, ...props }) {
  return <PlusIcon className={className} {...props} size={16} />;
}

export function Number({ className }) {
  return <Hash className={className} size={16} />;
}

export function Chart({ className }) {
  return <BarChart3 className={className} size={16} />;
}

export function Dumbbell({ className, ...props }) {
  return <DumbbellIcon className={className} {...props} size={16} />;
}
