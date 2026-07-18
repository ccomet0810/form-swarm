import type { LucideIcon } from "lucide-react";
import {
  AlignLeft,
  CheckSquare2,
  ChevronDown,
  CircleDot,
  Grid3X3,
  Hash,
  ListFilter,
  MessageSquareText,
  Star,
  TextCursorInput,
} from "lucide-react";
import type { QuestionType } from "../../lib/domain/form-schema";

const typeIcon: Record<QuestionType, LucideIcon> = {
  short_text: TextCursorInput,
  paragraph: AlignLeft,
  single_choice: CircleDot,
  dropdown: ChevronDown,
  checkboxes: CheckSquare2,
  scale: ListFilter,
  grid_single: Grid3X3,
  rating: Star,
  date: Hash,
  time: Hash,
  unknown: MessageSquareText,
};

export function QuestionIcon({ type }: { type: QuestionType }) {
  const Icon = typeIcon[type];
  return <Icon aria-hidden="true" size={17} strokeWidth={1.8} />;
}
