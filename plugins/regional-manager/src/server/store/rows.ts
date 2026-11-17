// What every part of the store shares: the database handle, and how a JSON column is read and written.
import type Database from "better-sqlite3";
import { z } from "zod";

/** The plugin's database. why a function: the host closes the handle on reload and reopens it on the next call, so it is never kept. */
export type Db = () => Database.Database;

/** A JSON column, parsed with `schema`. */
export const json = <T>(schema: z.ZodType<T>) => z.string().transform((text) => schema.parse(JSON.parse(text)));

/** A nullable JSON column, parsed with `schema`. */
export const nullableJson = <T>(schema: z.ZodType<T>) => json(schema).nullable();

/** A value for a nullable JSON column. */
export const jsonOrNull = (value: object | null): string | null => (value === null ? null : JSON.stringify(value));
