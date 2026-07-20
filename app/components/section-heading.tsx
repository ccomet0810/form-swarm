import type { FormSection } from "../../lib/domain/form-schema";

export function SectionHeading({
  section,
  headingId,
}: {
  section: FormSection;
  headingId: string;
}) {
  return (
    <header className="section-heading">
      <div>
        <h2 id={headingId}>{section.title || `섹션 ${section.index + 1}`}</h2>
        {section.description && <p>{section.description}</p>}
      </div>
    </header>
  );
}
