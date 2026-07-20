import type { ReactNode } from "react";
import { InfoDetails } from "./info-details";

export function FormItemCard({
  id,
  children,
  information,
}: {
  id?: string;
  children?: ReactNode;
  information: ReactNode;
}) {
  return (
    <article className="content-item" id={id}>
      <div className="content-item-body">{children}</div>
      <InfoDetails variant="card-row">{information}</InfoDetails>
    </article>
  );
}

export function FormItemCopy({
  title,
  description,
}: {
  title?: string | null;
  description?: string | null;
}) {
  if (!title && !description) return null;

  return (
    <div className="content-item-copy">
      {title && <h3>{title}</h3>}
      {description && <p>{description}</p>}
    </div>
  );
}
