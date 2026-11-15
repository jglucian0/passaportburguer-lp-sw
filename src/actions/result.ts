import type { ZodError } from "zod";

export type ActionSuccess<T = null> = { ok: true; data: T };

export type ActionFailure = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export type ActionResult<T = null> = ActionSuccess<T> | ActionFailure;

export function success<T>(data: T): ActionSuccess<T> {
  return { ok: true, data };
}

export function failure(error: string, fieldErrors?: ActionFailure["fieldErrors"]): ActionFailure {
  return { ok: false, error, fieldErrors };
}

export function fromZod(error: ZodError): ActionFailure {
  return failure("Dados inválidos.", error.flatten().fieldErrors);
}
