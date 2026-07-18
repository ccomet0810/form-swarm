export type QuestionType =
  | "short_text"
  | "paragraph"
  | "single_choice"
  | "dropdown"
  | "checkboxes"
  | "scale"
  | "grid_single"
  | "rating"
  | "date"
  | "time"
  | "unknown";

export interface FormOption {
  label: string;
  value: string;
  isOther: boolean;
}

export interface GridAxis {
  id: string;
  label: string;
}

export interface FormQuestion {
  id: string;
  itemId: string;
  entryIds: string[];
  sectionId: string;
  index: number;
  title: string;
  description: string | null;
  type: QuestionType;
  required: boolean;
  options: FormOption[];
  scale?: {
    lowLabel: string | null;
    highLabel: string | null;
  };
  grid?: {
    rows: GridAxis[];
    columns: GridAxis[];
    binding: "google_internal_row_ids";
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
  diagnostics: {
    warnings: string[];
    unsupportedQuestionCount: number;
  };
}

export type GeneratedAnswer = string | string[] | Record<string, string>;

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
