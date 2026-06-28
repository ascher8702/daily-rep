// App icon set, backed by lucide-react. Re-exported under the app's existing names with a default
// 22px size and a thin 1px stroke, so call sites are unchanged and any explicit strokeWidth (e.g. a
// bold check) still wins. Icons stroke with currentColor, so theme text colors apply as before.
import {
  Home,
  Dumbbell,
  Flame,
  ChartColumn,
  History,
  Settings,
  Plus,
  Check,
  X,
  ChevronRight as LuChevronRight,
  ChevronLeft as LuChevronLeft,
  ChevronUp as LuChevronUp,
  ChevronDown as LuChevronDown,
  Timer,
  RefreshCw,
  ArrowLeftRight,
  Trash2,
  Play,
  Target,
  Info,
  Search,
  Trophy,
  Link2,
  NotebookPen,
  Download,
  Lock,
  ShieldCheck,
  Cloud,
  Bell,
  Moon,
  CreditCard,
  Clock,
  SlidersHorizontal,
  CalendarDays,
  Mail,
  KeyRound,
  HeartPulse,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

export interface IconProps {
  size?: number
  className?: string
  strokeWidth?: number
}

/** Wrap a lucide icon with the app defaults: 22px and a hairline 1px stroke (callers may override). */
function icon(Glyph: LucideIcon) {
  function Icon({ size = 22, strokeWidth = 1, className }: IconProps) {
    return <Glyph size={size} strokeWidth={strokeWidth} className={className} />
  }
  return Icon
}

export const HomeIcon = icon(Home)
export const DumbbellIcon = icon(Dumbbell)
export const FlameIcon = icon(Flame)
export const ChartIcon = icon(ChartColumn)
export const HistoryIcon = icon(History)
export const SettingsIcon = icon(Settings)
export const PlusIcon = icon(Plus)
export const CheckIcon = icon(Check)
export const XIcon = icon(X)
export const ChevronRight = icon(LuChevronRight)
export const ChevronLeft = icon(LuChevronLeft)
export const ChevronUp = icon(LuChevronUp)
export const ChevronDown = icon(LuChevronDown)
export const TimerIcon = icon(Timer)
export const RefreshIcon = icon(RefreshCw)
export const SwapIcon = icon(ArrowLeftRight)
export const TrashIcon = icon(Trash2)
export const PlayIcon = icon(Play)
export const TargetIcon = icon(Target)
export const InfoIcon = icon(Info)
export const SearchIcon = icon(Search)
export const TrophyIcon = icon(Trophy)
export const LinkIcon = icon(Link2)
export const NoteIcon = icon(NotebookPen)
export const DownloadIcon = icon(Download)
export const LockIcon = icon(Lock)
export const ShieldCheckIcon = icon(ShieldCheck)
export const CloudIcon = icon(Cloud)
export const BellIcon = icon(Bell)
export const MoonIcon = icon(Moon)
export const CardIcon = icon(CreditCard)
export const ClockIcon = icon(Clock)
export const SlidersIcon = icon(SlidersHorizontal)
export const CalendarIcon = icon(CalendarDays)
export const MailIcon = icon(Mail)
export const KeyIcon = icon(KeyRound)
export const HeartPulseIcon = icon(HeartPulse)
export const AlertTriangleIcon = icon(TriangleAlert)
