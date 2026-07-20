export const MIN_RESPONSE_COUNT = 1;
export const MAX_RESPONSE_COUNT = 500;

export function isValidResponseCount(value: number | ""): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_RESPONSE_COUNT
    && value <= MAX_RESPONSE_COUNT;
}
