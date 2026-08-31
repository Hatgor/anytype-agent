import { type Static, type TSchema } from "typebox";
import Schema, { type Validator } from "typebox/schema";

const types = new Map<TSchema, Validator>();

export function check<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  let compiled = types.get(schema);
  if (!compiled) {
    compiled = Schema.Compile(schema);
    types.set(schema, compiled);
  }

  return compiled.Check(value);
}
