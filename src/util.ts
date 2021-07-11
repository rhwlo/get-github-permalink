export class GetPermalinkError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function failIfUndefined<T>(value: T | undefined, failureMessage: string): T {
  if (value === undefined) {
    throw new GetPermalinkError(failureMessage);
  }
  return value;
}

export function failIfNull<T>(value: T | null, failureMessage: string): T {
  if (value === null) {
    throw new GetPermalinkError(failureMessage);
  }
  return value;
}
