export type QuestionType =
  | "short_text"
  | "paragraph"
  | "single_choice"
  | "dropdown"
  | "checkboxes"
  | "scale"
  | "grid_single"
  | "grid_checkbox"
  | "rating"
  | "date"
  | "time"
  | "unknown";

export type FormNavigationTarget =
  | { kind: "next" }
  | { kind: "submit" }
  | { kind: "section"; sectionItemId: string }
  | { kind: "unknown"; rawValue: string };

export interface FormImageRef {
  /** Opaque media id contained in FB_PUBLIC_LOAD_DATA_. */
  sourceId: string;
  /** Ephemeral public URL emitted in the responder HTML, when it can be paired safely. */
  url: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  /** Undocumented alignment value; kept losslessly instead of guessing its meaning. */
  alignment: number | null;
  /** Third undocumented value in Google's image dimensions tuple. */
  rawTransform: number | null;
}

export interface FormVideoRef {
  provider: "youtube";
  videoId: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface FormOption {
  label: string;
  value: string;
  isOther: boolean;
  index?: number;
  image?: FormImageRef | null;
  branchTarget?: FormNavigationTarget | null;
}

export interface GridAxis {
  id: string;
  label: string;
  entryId?: string;
  required?: boolean;
}

export type FormValidation =
  | {
      kind: "number_range";
      operator: "between" | "not_between";
      min: number;
      max: number;
      errorMessage: string | null;
      rawCategory: number;
      rawOperator: number;
    }
  | {
      kind: "text_length";
      operator: "min" | "max";
      value: number;
      errorMessage: string | null;
      rawCategory: number;
      rawOperator: number;
    }
  | {
      kind: "selection_count";
      operator: "min" | "max" | "exact";
      value: number;
      errorMessage: string | null;
      rawCategory: number;
      rawOperator: number;
    };

export interface FormEntryBinding {
  entryId: string;
  /** Grid bindings use one Google entry id per row. */
  rowId: string | null;
  required: boolean;
}

export interface FormQuestion {
  id: string;
  itemId: string;
  entryIds: string[];
  entryBindings?: FormEntryBinding[];
  sectionId: string;
  index: number;
  /** Position in FB_PUBLIC_LOAD_DATA_'s ordered item list. */
  itemIndex?: number;
  title: string;
  description: string | null;
  type: QuestionType;
  required: boolean;
  options: FormOption[];
  images?: FormImageRef[];
  validations?: FormValidation[];
  scale?: {
    min: number;
    max: number;
    lowLabel: string | null;
    highLabel: string | null;
  };
  grid?: {
    rows: GridAxis[];
    columns: GridAxis[];
    binding: "google_internal_row_ids";
    mode?: "single" | "multiple";
    requireResponsePerRow?: boolean;
    limitOneResponsePerColumn?: boolean;
  };
  rating?: {
    icon: "star" | "heart" | "thumbs_up" | "unknown";
    min: number;
    max: number;
  };
  date?: {
    includeYear: boolean;
    includeTime: boolean;
  };
  time?: {
    kind: "time_of_day" | "duration";
  };
  rawType: number;
}

export interface FormSection {
  id: string;
  itemId: string | null;
  index: number;
  title: string;
  description: string | null;
  questionIds: string[];
  navigation?: FormNavigationTarget;
}

interface OrderedFormItemBase {
  id: string;
  itemId: string;
  itemIndex: number;
  sectionId: string;
  title: string;
  description: string | null;
  rawType: number;
}

export interface FormQuestionItem extends FormQuestion {
  kind: "question";
  itemIndex: number;
  entryBindings: FormEntryBinding[];
  images: FormImageRef[];
  validations: FormValidation[];
}

export interface FormSectionItem extends OrderedFormItemBase {
  kind: "section";
  sectionIndex: number;
  navigation: FormNavigationTarget;
}

export interface FormTextBlockItem extends OrderedFormItemBase {
  kind: "text_block";
}

export interface FormImageItem extends OrderedFormItemBase {
  kind: "image";
  image: FormImageRef;
}

export interface FormVideoItem extends OrderedFormItemBase {
  kind: "video";
  video: FormVideoRef;
}

export type FormItem =
  | FormQuestionItem
  | FormSectionItem
  | FormTextBlockItem
  | FormImageItem
  | FormVideoItem;

export interface FormSubmissionMetadata {
  actionUrl: string | null;
  fvv: string | null;
  fbzx: string | null;
  pageHistory: string | null;
  partialResponse: string | null;
}

export interface SkippedFormItem {
  itemId: string;
  rawType: number;
  title: string;
  reason: "file_upload";
}

export interface ImportedForm {
  schemaVersion: "1.0";
  parserVersion: string;
  source: {
    requestedUrl: string;
    canonicalUrl: string;
    publicId: string;
    fetchedAt: string;
  };
  title: string;
  description: string | null;
  locale: string;
  sections: FormSection[];
  questions: FormQuestion[];
  /** Ordered responder-page content. Present on newly parsed forms. */
  items?: FormItem[];
  /** Public hidden fields needed by a separate, explicit submit operation. */
  submission?: FormSubmissionMetadata;
  diagnostics: {
    warnings: string[];
    unsupportedQuestionCount: number;
    skippedItems?: SkippedFormItem[];
  };
}

export type GeneratedAnswer =
  | string
  | string[]
  | Record<string, string | string[]>;

export interface GeneratedResponse {
  id: string;
  index: number;
  answers: Record<string, GeneratedAnswer>;
}

export type GenerationRule =
  | {
      questionId: string;
      enabled: boolean;
      kind: "text";
      mode: "sequence" | "sample_pool";
      samples: string[];
    }
  | {
      questionId: string;
      enabled: boolean;
      kind: "choice";
      mode: "uniform" | "middle_weighted" | "fixed";
      fixedValue?: string;
    }
  | {
      questionId: string;
      enabled: boolean;
      kind: "checkboxes";
      minSelections: number;
      maxSelections: number;
    }
  | {
      questionId: string;
      enabled: boolean;
      kind: "grid";
      mode: "uniform" | "middle_weighted";
    }
  | {
      questionId: string;
      enabled: false;
      kind: "unsupported";
    };
